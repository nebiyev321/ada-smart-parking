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

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    myada_user_id TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    affiliation TEXT NOT NULL CHECK (affiliation IN ('student','faculty','staff')),
    is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS staff_roles (
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
    created_at TEXT NOT NULL
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
    confidence REAL
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

# Stand-in for the MyADA directory. In production these rows come from MyADA / SSO claims.
DEMO_USERS = [
    ("S1001", "Leyla Mammadova", "lmammadova@ada.edu.az", "+994 50 111 22 33", "student", []),
    ("S1002", "Murad Aliyev", "maliyev@ada.edu.az", "+994 55 222 33 44", "student", []),
    ("F2001", "Dr. Nigar Huseynova", "nhuseynova@ada.edu.az", "+994 51 333 44 55", "faculty", []),
    ("E3001", "Rashad Karimov", "rkarimov@ada.edu.az", "+994 70 444 55 66", "staff", ["guard"]),
    ("E3002", "Aysel Guliyeva", "aguliyeva@ada.edu.az", "+994 77 555 66 77", "staff", ["parking_admin"]),
    ("E3003", "Tural Hasanov", "thasanov@ada.edu.az", "+994 50 666 77 88", "staff", ["system_admin", "parking_admin"]),
]

DEFAULT_SETTINGS = {"change_cooldown_days": "90"}

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


def init(conn):
    pg = isinstance(conn, PostgresDatabase)
    with conn.session(), conn.transaction():
        if pg:
            # Serverless instances can cold-start together; only one creates the schema.
            conn.execute("SELECT pg_advisory_xact_lock(4207)")
            conn.executescript(SCHEMA.replace("id INTEGER PRIMARY KEY", "id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY"))
        else:
            conn.executescript(SCHEMA)
        insert, ignore = ("INSERT INTO", " ON CONFLICT DO NOTHING") if pg else ("INSERT OR IGNORE INTO", "")
        for myada_id, name, email, phone, aff, roles in DEMO_USERS:
            conn.execute(
                f"{insert} users (myada_user_id, full_name, email, phone, affiliation) VALUES (?,?,?,?,?){ignore}",
                (myada_id, name, email, phone, aff),
            )
            uid = conn.execute("SELECT id FROM users WHERE myada_user_id=?", (myada_id,)).fetchone()["id"]
            for r in roles:
                conn.execute(f"{insert} staff_roles (user_id, role) VALUES (?,?){ignore}", (uid, r))
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute(f"{insert} settings (key, value) VALUES (?,?){ignore}", (k, v))
