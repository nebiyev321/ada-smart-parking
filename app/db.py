"""Storage for the service.

PostgreSQL when DATABASE_URL is set (the Vercel deployment uses Neon), otherwise a local
SQLite file. Route code writes SQLite-style SQL ("?" placeholders, cursor.lastrowid);
the Postgres backend translates it, so both backends share one set of queries.
"""
import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from contextvars import ContextVar

DB_PATH = os.environ.get("PARKING_DB", os.path.join(os.path.dirname(__file__), "..", "parking.db"))
DATABASE_URL = os.environ.get("DATABASE_URL")

# The member groups a site can have. Groups are labels for admins; permit length comes from settings.
GROUPS = ("member", "contractor", "staff")

USERS_TABLE = """CREATE TABLE IF NOT EXISTS {name} (
    id INTEGER PRIMARY KEY,
    account_id TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    affiliation TEXT NOT NULL CHECK (affiliation IN ('member','contractor','staff')),
    is_active INTEGER NOT NULL DEFAULT 1
);
"""

SCHEMA = USERS_TABLE.format(name="users") + """CREATE TABLE IF NOT EXISTS staff_roles (
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('guard','parking_admin','system_admin')),
    PRIMARY KEY (user_id, role)
);
CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    plate_display TEXT NOT NULL,
    plate_normalized TEXT NOT NULL,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS permits (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
    status TEXT NOT NULL CHECK (status IN ('pending','active','rejected','suspended','expired','inactive')),
    valid_from TEXT,
    valid_until TEXT,
    decided_by INTEGER REFERENCES users(id),
    decided_at TEXT,
    reason TEXT,
    created_at TEXT NOT NULL,
    renews_permit_id INTEGER REFERENCES permits(id)
);
-- One active permit per person. "One active permit per plate" is checked in the service layer.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_permit_per_user ON permits(user_id) WHERE status = 'active';
-- One request waiting for approval per person, so a double submit cannot queue two.
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_permit_per_user ON permits(user_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS cooldown_overrides (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    granted_by INTEGER NOT NULL REFERENCES users(id),
    granted_at TEXT NOT NULL,
    used_at TEXT
);
CREATE TABLE IF NOT EXISTS change_requests (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    old_permit_id INTEGER NOT NULL REFERENCES permits(id),
    new_permit_id INTEGER NOT NULL REFERENCES permits(id),
    status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    override_id INTEGER REFERENCES cooldown_overrides(id)
);
-- A one-day pass for a guest's plate, issued by a member (the host) or an admin.
CREATE TABLE IF NOT EXISTS visitor_passes (
    id INTEGER PRIMARY KEY,
    host_id INTEGER NOT NULL REFERENCES users(id),
    plate_display TEXT NOT NULL,
    plate_normalized TEXT NOT NULL,
    guest_name TEXT,
    valid_on TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    -- Guards or admins approve a pass before the gate honours it.
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected')),
    decided_by INTEGER REFERENCES users(id),
    decided_at TEXT,
    reason TEXT
);
CREATE INDEX IF NOT EXISTS visitor_passes_plate_day ON visitor_passes(plate_normalized, valid_on);
CREATE TABLE IF NOT EXISTS gate_events (
    id INTEGER PRIMARY KEY,
    plate_display TEXT NOT NULL,
    plate_normalized TEXT NOT NULL,
    permit_id INTEGER REFERENCES permits(id),
    authorized INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in','out')),
    gate_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual','anpr','rfid')),
    recorded_by INTEGER REFERENCES users(id),
    confidence REAL,
    visitor_pass_id INTEGER REFERENCES visitor_passes(id)
);
CREATE INDEX IF NOT EXISTS gate_events_plate ON gate_events(plate_normalized);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    details TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

# Stand-in for the organisation's directory. In production these rows come from the identity provider (SSO claims).
DEMO_USERS = [
    ("M1001", "Leyla Mammadova", "leyla.mammadova@example.com", "+994 50 111 22 33", "member", []),
    ("M1002", "Murad Aliyev", "murad.aliyev@example.com", "+994 55 222 33 44", "member", []),
    ("C2001", "Nigar Huseynova", "nigar.huseynova@example.com", "+994 51 333 44 55", "contractor", []),
    ("E3001", "Rashad Karimov", "rashad.karimov@example.com", "+994 70 444 55 66", "staff", ["guard"]),
    ("E3002", "Aysel Guliyeva", "aysel.guliyeva@example.com", "+994 77 555 66 77", "staff", ["parking_admin"]),
    ("E3003", "Tural Hasanov", "tural.hasanov@example.com", "+994 50 666 77 88", "staff", ["system_admin", "parking_admin"]),
]
# Demo accounts from the campus-only release, renamed in place so their permits and history carry over.
RENAMED_DEMO_IDS = {"S1001": "M1001", "S1002": "M1002", "F2001": "C2001"}

# permit_fixed_end is "MM-DD" or empty: when set, every permit ends on the next such day (an academic year, a season)
# instead of running permit_term_days.
DEFAULT_SETTINGS = {"change_cooldown_days": "90", "renewal_window_days": "30",
                    "permit_term_days": "365", "permit_fixed_end": ""}

# Columns added after the first release. CREATE TABLE IF NOT EXISTS leaves existing tables alone,
# so databases created before these columns existed get them here.
ADDED_COLUMNS = [
    ("permits", "renews_permit_id", "INTEGER REFERENCES permits(id)"),
    ("gate_events", "visitor_pass_id", "INTEGER REFERENCES visitor_passes(id)"),
    ("visitor_passes", "status", "TEXT NOT NULL DEFAULT 'approved'"),
    ("visitor_passes", "decided_by", "INTEGER REFERENCES users(id)"),
    ("visitor_passes", "decided_at", "TEXT"),
    ("visitor_passes", "reason", "TEXT"),
]

INTEGRITY_ERRORS = (sqlite3.IntegrityError,)
try:
    import psycopg

    INTEGRITY_ERRORS += (psycopg.IntegrityError,)
except ImportError:
    pass


class SQLiteDatabase:
    """One connection per thread. FastAPI runs requests in parallel worker threads, and a
    single shared sqlite3 connection mixes up their cursors (wrong rows, InterfaceError)."""

    def __init__(self):
        self._local = threading.local()
        self._all = []
        self._lock = threading.Lock()

    @property
    def conn(self):
        c = getattr(self._local, "conn", None)
        if c is None:
            c = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA foreign_keys = ON")
            c.execute("PRAGMA journal_mode = WAL")
            self._local.conn = c
            with self._lock:
                self._all.append(c)
        return c

    def execute(self, sql, params=()):
        return self.conn.execute(sql, params)

    def executescript(self, script):
        self.conn.executescript(script)

    @contextmanager
    def session(self):
        yield

    @contextmanager
    def transaction(self):
        try:
            yield self
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def close(self):
        with self._lock:
            for c in self._all:
                c.close()
            self._all.clear()
        self._local = threading.local()


class _PgCursor:
    def __init__(self, cur, returning_id):
        self._cur = cur
        self.rowcount = cur.rowcount
        self.lastrowid = cur.fetchone()["id"] if returning_id else None

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def __iter__(self):
        return iter(self._cur)


def _to_pg(sql):
    sql = re.sub(r"GROUP_CONCAT\(([^)]*)\)", r"string_agg(\1, ',')", sql)
    return sql.replace("?", "%s")


# The connection checked out for the current request (see PostgresDatabase.session).
_request_conn = ContextVar("request_conn", default=None)


class PostgresDatabase:
    """Connection pool; each request borrows one connection and returns it when done."""

    def __init__(self, url):
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool

        self.pool = ConnectionPool(
            url,
            min_size=0,
            max_size=5,
            # Neon's pooler runs PgBouncer in transaction mode, so no server-side prepared statements.
            kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": None},
            check=ConnectionPool.check_connection,
            open=True,
        )

    def _conn(self):
        holder = _request_conn.get()
        if holder is None:
            raise RuntimeError("Database used outside a request session")
        if holder["conn"] is None:
            holder["conn"] = self.pool.getconn()
        return holder["conn"]

    def execute(self, sql, params=()):
        sql = _to_pg(sql)
        returning_id = sql.lstrip().upper().startswith("INSERT") and "ON CONFLICT" not in sql.upper()
        if returning_id:
            sql += " RETURNING id"
        return _PgCursor(self._conn().execute(sql, params), returning_id)

    def executescript(self, script):
        self._conn().execute(script)

    @contextmanager
    def session(self):
        """Lends a connection to everything that runs inside, including worker threads."""
        holder = {"conn": None}
        token = _request_conn.set(holder)
        try:
            yield
        finally:
            _request_conn.reset(token)
            if holder["conn"] is not None:
                self.pool.putconn(holder["conn"])

    @contextmanager
    def transaction(self):
        with self._conn().transaction():
            yield self

    def close(self):
        self.pool.close()


def connect():
    return PostgresDatabase(DATABASE_URL) if DATABASE_URL else SQLiteDatabase()


def tx(conn):
    return conn.transaction()


# The campus-only release keyed users by myada_user_id and grouped them as student/faculty/staff.
GROUP_FROM_CAMPUS = "CASE affiliation WHEN 'staff' THEN 'staff' ELSE 'member' END"


def _migrate_sqlite_users(conn):
    """SQLite cannot change a CHECK constraint in place, so the users table is rebuilt (SQLite's documented
    12-step procedure). Foreign keys are off while it runs, so references to users stay intact."""
    if "myada_user_id" not in {r["name"] for r in conn.execute("PRAGMA table_info(users)")}:
        return
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.executescript(
            "BEGIN;" + USERS_TABLE.format(name="users_new")
            + f"""INSERT INTO users_new (id, account_id, full_name, email, phone, affiliation, is_active)
                  SELECT id, myada_user_id, full_name, email, phone, {GROUP_FROM_CAMPUS}, is_active FROM users;
                  DROP TABLE users;
                  ALTER TABLE users_new RENAME TO users;
                  COMMIT;"""
        )
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def _migrate_pg_users(conn):
    if not conn.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='myada_user_id'"
    ).fetchone():
        return
    conn.execute("ALTER TABLE users RENAME COLUMN myada_user_id TO account_id")
    conn.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_affiliation_check")
    conn.execute(f"UPDATE users SET affiliation = {GROUP_FROM_CAMPUS}")
    groups = ",".join(f"'{g}'" for g in GROUPS)
    conn.execute(f"ALTER TABLE users ADD CONSTRAINT users_affiliation_check CHECK (affiliation IN ({groups}))")


def init(conn):
    pg = isinstance(conn, PostgresDatabase)
    if not pg:
        _migrate_sqlite_users(conn)
    with conn.session(), conn.transaction():
        if pg:
            # Serverless instances can cold-start together; only one creates the schema.
            conn.execute("SELECT pg_advisory_xact_lock(4207)")
            conn.executescript(SCHEMA.replace("id INTEGER PRIMARY KEY", "id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY"))
        else:
            conn.executescript(SCHEMA)
        if pg:
            _migrate_pg_users(conn)
        for table, column, decl in ADDED_COLUMNS:
            if pg:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {decl}")
            elif column not in {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
        insert, ignore = ("INSERT INTO", " ON CONFLICT DO NOTHING") if pg else ("INSERT OR IGNORE INTO", "")
        demo = {d[0]: d for d in DEMO_USERS}
        for old_id, new_id in RENAMED_DEMO_IDS.items():
            _, name, email, _, group, _ = demo[new_id]
            conn.execute("UPDATE users SET account_id=?, full_name=?, email=?, affiliation=? WHERE account_id=?",
                         (new_id, name, email, group, old_id))
        for account_id, name, email, phone, group, roles in DEMO_USERS:
            conn.execute(
                f"{insert} users (account_id, full_name, email, phone, affiliation) VALUES (?,?,?,?,?){ignore}",
                (account_id, name, email, phone, group),
            )
            uid = conn.execute("SELECT id FROM users WHERE account_id=?", (account_id,)).fetchone()["id"]
            for r in roles:
                conn.execute(f"{insert} staff_roles (user_id, role) VALUES (?,?){ignore}", (uid, r))
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute(f"{insert} settings (key, value) VALUES (?,?){ignore}", (k, v))
