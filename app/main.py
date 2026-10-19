"""ADA Smart Parking: MVP prototype of the Parking service that sits beside MyADA."""
import csv
import hashlib
import io
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db
from .auth import DEMO_LOGIN, DEPLOYED, current_user, gate_device, issue_token, require

STATIC = Path(__file__).parent / "static"
BAKU = timezone(timedelta(hours=4))  # Azerbaijan has no daylight saving time
STAFF = ("guard", "parking_admin", "system_admin")
ADMINS = ("parking_admin", "system_admin")
# Letters and digits, optionally split by single spaces or hyphens: "10-AB-123", "90 XY 777".
PLATE = r"^[A-Za-z0-9]+([ -][A-Za-z0-9]+)*$"
# Printable text only, no control characters or markup brackets.
TEXT = r"^[^\x00-\x1f\x7f<>]+$"


def now() -> datetime:
    """Single clock for the service, so tests can move time forward."""
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def normalize_plate(plate: str) -> str:
    """'10-ab-123' and '10 AB 123' both become '10AB123'."""
    return re.sub(r"[^A-Z0-9]", "", plate.upper())


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.conn = db.connect()
    db.init(app.state.conn)
    with app.state.conn.session():
        expire_permits()
    yield
    app.state.conn.close()


# Interactive API docs are for local development; a deployment opts in with PARKING_DOCS=1.
DOCS = os.environ.get("PARKING_DOCS", "0" if DEPLOYED else "1") == "1"
app = FastAPI(
    title="ADA Smart Parking", version="0.1.0", lifespan=lifespan,
    docs_url="/docs" if DOCS else None, redoc_url="/redoc" if DOCS else None,
    openapi_url="/openapi.json" if DOCS else None,
)


@app.middleware("http")
async def db_session(request: Request, call_next):
    with app.state.conn.session():
        return await call_next(request)


CSP = ("default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    h["X-Content-Type-Options"] = "nosniff"
    h["Referrer-Policy"] = "no-referrer"
    h["X-Frame-Options"] = "DENY"
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if not request.url.path.startswith(("/docs", "/redoc")):  # Swagger UI loads its own scripts
        h["Content-Security-Policy"] = CSP
    if request.url.path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    elif request.url.path.startswith("/static/"):
        # Fingerprinted URLs (?v=) never change; anything else revalidates so a deploy shows at once.
        h["Cache-Control"] = "public, max-age=31536000, immutable" if "v" in request.query_params else "no-cache"
    return response


async def integrity_error(request: Request, exc):
    return JSONResponse({"detail": "This conflicts with a change made a moment ago. Refresh and try again."}, 409)


for _err in db.INTEGRITY_ERRORS:
    app.add_exception_handler(_err, integrity_error)


def conn():
    return app.state.conn


def audit(actor_id, action, target_type=None, target_id=None, **details):
    conn().execute(
        "INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at) VALUES (?,?,?,?,?,?)",
        (actor_id, action, target_type, target_id, json.dumps(details) if details else None, iso(now())),
    )


def setting(key: str) -> str:
    return conn().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()["value"]


def permit_end(affiliation: str, start: datetime) -> datetime:
    """Students: end of the academic year (30 June, 23:59 in Baku). Faculty and staff: one year."""
    if affiliation == "student":
        year = start.year if start.month < 7 else start.year + 1
        return datetime(year, 6, 30, 23, 59, 59, tzinfo=BAKU).astimezone(timezone.utc)
    return start + timedelta(days=365)


def expire_permits() -> int:
    """Nightly job in production; also runs at startup and on demand."""
    with db.tx(conn()) as c:
        cur = c.execute(
            "UPDATE permits SET status='expired' WHERE status='active' AND valid_until < ?", (iso(now()),)
        )
        if cur.rowcount:
            audit(None, "permits_expired", count=cur.rowcount)
        return cur.rowcount


def plate_taken(plate_norm: str, exclude_user: int) -> bool:
    row = conn().execute(
        """SELECT 1 FROM permits p JOIN vehicles v ON v.id=p.vehicle_id
           WHERE v.plate_normalized=? AND p.status IN ('active','pending') AND p.user_id<>?""",
        (plate_norm, exclude_user),
    ).fetchone()
    return row is not None


def permit_view(permit_id: Optional[int]):
    if not permit_id:
        return None
    row = conn().execute(
        """SELECT p.id, p.status, p.valid_from, p.valid_until, p.reason, p.created_at,
                  v.id AS vehicle_id, v.plate_display, v.plate_normalized, v.make, v.model, v.color
           FROM permits p JOIN vehicles v ON v.id=p.vehicle_id WHERE p.id=?""",
        (permit_id,),
    ).fetchone()
    return dict(row) if row else None


def change_window(user_id: int):
    """Returns (allowed_now, next_allowed_at, override_id).

    The cooldown runs from the date the current vehicle became active, so a person
    cannot register one car and swap it the next day.
    """
    active = conn().execute(
        "SELECT valid_from FROM permits WHERE user_id=? AND status='active'", (user_id,)
    ).fetchone()
    if not active:
        return False, None, None
    override = conn().execute(
        "SELECT id FROM cooldown_overrides WHERE user_id=? AND used_at IS NULL ORDER BY id DESC", (user_id,)
    ).fetchone()
    next_at = datetime.fromisoformat(active["valid_from"]) + timedelta(days=int(setting("change_cooldown_days")))
    if override:
        return True, iso(next_at), override["id"]
    return now() >= next_at, iso(next_at), None


# ---------------------------------------------------------------- mocked MyADA sign-in

class LoginIn(BaseModel):
    myada_user_id: str = Field(max_length=32)


def demo_login_enabled():
    if not DEMO_LOGIN:
        raise HTTPException(404, "Demo sign-in is turned off. Sign in through MyADA.")


@app.get("/api/v1/auth/demo-users", dependencies=[Depends(demo_login_enabled)])
def demo_users():
    rows = conn().execute(
        """SELECT u.myada_user_id, u.full_name, u.affiliation, GROUP_CONCAT(r.role) AS roles
           FROM users u LEFT JOIN staff_roles r ON r.user_id=u.id GROUP BY u.id ORDER BY u.id"""
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/v1/auth/mock-login", dependencies=[Depends(demo_login_enabled)])
def mock_login(body: LoginIn):
    user = conn().execute("SELECT id FROM users WHERE myada_user_id=?", (body.myada_user_id,)).fetchone()
    if not user:
        raise HTTPException(404, "No such MyADA account")
    return {"token": issue_token(body.myada_user_id)}


# ---------------------------------------------------------------- vehicle owner

class VehicleIn(BaseModel):
    plate: str = Field(min_length=3, max_length=16, pattern=PLATE)
    make: str = Field(min_length=1, max_length=40, pattern=TEXT)
    model: str = Field(min_length=1, max_length=40, pattern=TEXT)
    color: str = Field(min_length=1, max_length=30, pattern=TEXT)


@app.get("/api/v1/me")
def me(user=Depends(current_user)):
    uid = user["id"]
    active = conn().execute("SELECT id FROM permits WHERE user_id=? AND status='active'", (uid,)).fetchone()
    pending = conn().execute(
        "SELECT id FROM permits WHERE user_id=? AND status='pending' ORDER BY id DESC", (uid,)
    ).fetchone()
    last = conn().execute(
        "SELECT id FROM permits WHERE user_id=? AND status IN ('rejected','suspended','expired') ORDER BY id DESC",
        (uid,),
    ).fetchone()
    allowed, next_at, override = change_window(uid)
    return {
        "user": {k: user[k] for k in ("id", "myada_user_id", "full_name", "email", "affiliation")},
        "roles": sorted(user["roles"]),
        "active_permit": permit_view(active and active["id"]),
        "pending_permit": permit_view(pending and pending["id"]),
        "latest_inactive_permit": permit_view(last and last["id"]),
        "change": {
            "allowed_now": allowed and not pending,
            "next_allowed_at": next_at,
            "cooldown_days": int(setting("change_cooldown_days")),
            "override_granted": override is not None,
        },
    }


def _create_vehicle_and_permit(c, user_id, body: VehicleIn):
    plate_norm = normalize_plate(body.plate)
    if len(plate_norm) < 3:
        raise HTTPException(422, "Plate number looks too short")
    if plate_taken(plate_norm, user_id):
        raise HTTPException(409, "This plate is already registered to another ADA account")
    ts = iso(now())
    vid = c.execute(
        """INSERT INTO vehicles (owner_id, plate_display, plate_normalized, make, model, color, created_at)
           VALUES (?,?,?,?,?,?,?)""",
        (user_id, body.plate.strip().upper(), plate_norm, body.make.strip(), body.model.strip(), body.color.strip(), ts),
    ).lastrowid
    pid = c.execute(
        "INSERT INTO permits (user_id, vehicle_id, status, created_at) VALUES (?,?, 'pending', ?)",
        (user_id, vid, ts),
    ).lastrowid
    return vid, pid


@app.post("/api/v1/vehicles", status_code=201)
def register_vehicle(body: VehicleIn, user=Depends(current_user)):
    uid = user["id"]
    existing = conn().execute(
        "SELECT status FROM permits WHERE user_id=? AND status IN ('active','pending','suspended')", (uid,)
    ).fetchone()
    if existing:
        raise HTTPException(
            409,
            {
                "active": "You already have a registered vehicle. Use 'Change vehicle' instead.",
                "pending": "Your registration is waiting for approval.",
                "suspended": "Your parking permit is suspended. Contact the parking office before registering a vehicle.",
            }[existing["status"]],
        )
    with db.tx(conn()) as c:
        vid, pid = _create_vehicle_and_permit(c, uid, body)
        audit(uid, "vehicle_registered", "permit", pid, plate=normalize_plate(body.plate))
    return permit_view(pid)


@app.post("/api/v1/change-requests", status_code=201)
def request_change(body: VehicleIn, user=Depends(current_user)):
    uid = user["id"]
    active = conn().execute("SELECT id FROM permits WHERE user_id=? AND status='active'", (uid,)).fetchone()
    if not active:
        raise HTTPException(409, "You need an active permit before you can change vehicle")
    if conn().execute("SELECT 1 FROM permits WHERE user_id=? AND status='pending'", (uid,)).fetchone():
        raise HTTPException(409, "You already have a request waiting for approval")
    allowed, next_at, override_id = change_window(uid)
    if not allowed:
        raise HTTPException(
            409,
            detail={"message": "Vehicle change is not allowed yet", "next_allowed_at": next_at},
        )
    with db.tx(conn()) as c:
        vid, pid = _create_vehicle_and_permit(c, uid, body)
        cr = c.execute(
            """INSERT INTO change_requests (user_id, old_permit_id, new_permit_id, status, requested_at, override_id)
               VALUES (?,?,?, 'pending', ?, ?)""",
            (uid, active["id"], pid, iso(now()), override_id),
        ).lastrowid
        if override_id:
            c.execute("UPDATE cooldown_overrides SET used_at=? WHERE id=?", (iso(now()), override_id))
        audit(uid, "change_requested", "change_request", cr, plate=normalize_plate(body.plate),
              used_override=bool(override_id))
    return {"change_request_id": cr, "permit": permit_view(pid)}


@app.get("/api/v1/me/gate-events")
def my_gate_events(user=Depends(current_user)):
    rows = conn().execute(
        """SELECT g.plate_display, g.direction, g.gate_id, g.occurred_at, g.source
           FROM gate_events g JOIN permits p ON p.id=g.permit_id
           WHERE p.user_id=? ORDER BY g.occurred_at DESC LIMIT 100""",
        (user["id"],),
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/v1/me/messages")
def my_messages(user=Depends(current_user)):
    rows = conn().execute(
        """SELECT m.subject, m.body, m.created_at, u.full_name AS sender
           FROM messages m JOIN users u ON u.id=m.from_user_id WHERE m.to_user_id=? ORDER BY m.id DESC""",
        (user["id"],),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- guards and admins

@app.get("/api/v1/admin/vehicles")
def search_vehicles(plate: str = Query(min_length=2), user=Depends(require(*STAFF))):
    """Partial plate search. Guards see name and status; admins also see contact details."""
    is_admin = bool(user["roles"] & set(ADMINS))
    rows = conn().execute(
        """SELECT v.id AS vehicle_id, v.plate_display, v.plate_normalized, v.make, v.model, v.color,
                  u.id AS user_id, u.full_name, u.affiliation, u.email, u.phone,
                  p.id AS permit_id, p.status, p.valid_until
           FROM vehicles v JOIN users u ON u.id=v.owner_id
           JOIN permits p ON p.vehicle_id=v.id
           WHERE v.plate_normalized LIKE ?
           ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, p.id DESC
           LIMIT 25""",
        (f"%{normalize_plate(plate)}%",),
    ).fetchall()
    out = []
    for r in rows:
        item = dict(r)
        last = conn().execute(
            "SELECT direction, occurred_at, gate_id FROM gate_events WHERE plate_normalized=? ORDER BY occurred_at DESC",
            (r["plate_normalized"],),
        ).fetchone()
        item["last_event"] = dict(last) if last else None
        if not is_admin:
            item.pop("email"), item.pop("phone")
        out.append(item)
    with db.tx(conn()):
        audit(user["id"], "plate_search", query=normalize_plate(plate), results=len(out),
              contact_details_shown=is_admin and bool(out))
    return out


class GateEventIn(BaseModel):
    plate: str = Field(min_length=3, max_length=16, pattern=PLATE)
    direction: Literal["in", "out"]
    gate_id: str = Field(default="main", max_length=20, pattern=r"^[a-z0-9-]+$")


def _record_gate_event(plate: str, direction: str, gate_id: str, source: str, recorded_by=None, confidence=None):
    plate_norm = normalize_plate(plate)
    permit = conn().execute(
        """SELECT p.id, u.full_name, u.affiliation, v.make, v.model, v.color, v.plate_display
           FROM permits p JOIN vehicles v ON v.id=p.vehicle_id JOIN users u ON u.id=p.user_id
           WHERE v.plate_normalized=? AND p.status='active' AND p.valid_until >= ?""",
        (plate_norm, iso(now())),
    ).fetchone()
    authorized = permit is not None
    # Show the plate as registered when we know it, so "10ab123" at the gate reads "10-AB-123" everywhere.
    display = permit["plate_display"] if authorized else plate.strip().upper()
    with db.tx(conn()) as c:
        eid = c.execute(
            """INSERT INTO gate_events (plate_display, plate_normalized, permit_id, authorized, direction, gate_id,
                                        occurred_at, source, recorded_by, confidence)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (display, plate_norm, permit and permit["id"], int(authorized), direction, gate_id,
             iso(now()), source, recorded_by, confidence),
        ).lastrowid
    return {
        "event_id": eid,
        "plate": plate_norm,
        "plate_display": display,
        "authorized": authorized,
        "decision": "allow" if authorized else "check",
        "owner": permit and permit["full_name"],
        "affiliation": permit and permit["affiliation"],
        "vehicle": permit and f'{permit["color"]} {permit["make"]} {permit["model"]}',
    }


@app.post("/api/v1/admin/gate-events", status_code=201)
def record_gate_event(body: GateEventIn, user=Depends(require(*STAFF))):
    return _record_gate_event(body.plate, body.direction, body.gate_id, "manual", recorded_by=user["id"])


class GateReadIn(GateEventIn):
    source: Literal["anpr", "rfid"] = "anpr"
    confidence: Optional[float] = Field(default=None, ge=0, le=1)


@app.post("/api/v1/gate/reads", status_code=201, dependencies=[Depends(gate_device)])
def gate_read(body: GateReadIn):
    """Phase 2: cameras or RFID readers post here with their own API key."""
    result = _record_gate_event(body.plate, body.direction, body.gate_id, body.source, confidence=body.confidence)
    if body.confidence is not None and body.confidence < 0.8:
        result["decision"] = "check"  # low-confidence reads go to the guard, never auto-deny
    return result


@app.get("/api/v1/admin/gate-events")
def list_gate_events(
    plate: Optional[str] = None,
    date_from: Optional[date] = Query(default=None, alias="from"),
    date_to: Optional[date] = Query(default=None, alias="to"),
    format: Literal["json", "csv"] = "json",
    user=Depends(require(*STAFF)),
):
    sql = """SELECT g.id, g.occurred_at, g.direction, g.gate_id, g.plate_display, g.authorized, g.source,
                    u.full_name AS owner, rec.full_name AS recorded_by
             FROM gate_events g
             LEFT JOIN permits p ON p.id=g.permit_id LEFT JOIN users u ON u.id=p.user_id
             LEFT JOIN users rec ON rec.id=g.recorded_by WHERE 1=1"""
    args = []
    if plate:
        sql += " AND g.plate_normalized LIKE ?"
        args.append(f"%{normalize_plate(plate)}%")
    if date_from:
        sql += " AND g.occurred_at >= ?"
        args.append(date_from.isoformat())
    if date_to:
        sql += " AND g.occurred_at < ?"
        args.append((date_to + timedelta(days=1)).isoformat())
    rows = [dict(r) for r in conn().execute(sql + " ORDER BY g.occurred_at DESC, g.id DESC LIMIT 500", args)]
    if format == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=rows[0].keys() if rows else ["id"])
        writer.writeheader()
        writer.writerows({k: csv_safe(v) for k, v in r.items()} for r in rows)
        return StreamingResponse(
            iter([buf.getvalue()]), media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=gate-log.csv"},
        )
    return rows


def csv_safe(value):
    """Stops spreadsheet apps from running a cell as a formula."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


@app.get("/api/v1/admin/queue")
def approval_queue(user=Depends(require(*ADMINS))):
    rows = conn().execute(
        """SELECT p.id AS permit_id, p.created_at, u.id AS user_id, u.full_name, u.affiliation, u.email,
                  v.plate_display, v.make, v.model, v.color,
                  cr.id AS change_request_id, ov.plate_display AS replaces_plate
           FROM permits p JOIN users u ON u.id=p.user_id JOIN vehicles v ON v.id=p.vehicle_id
           LEFT JOIN change_requests cr ON cr.new_permit_id=p.id
           LEFT JOIN permits op ON op.id=cr.old_permit_id LEFT JOIN vehicles ov ON ov.id=op.vehicle_id
           WHERE p.status='pending' ORDER BY p.created_at"""
    ).fetchall()
    return [dict(r) for r in rows]


class DecisionIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)


def _pending_permit(permit_id):
    p = conn().execute("SELECT * FROM permits WHERE id=?", (permit_id,)).fetchone()
    if not p:
        raise HTTPException(404, "Permit not found")
    return p


@app.post("/api/v1/admin/permits/{permit_id}/approve")
def approve(permit_id: int, body: DecisionIn = DecisionIn(), user=Depends(require(*ADMINS))):
    p = _pending_permit(permit_id)
    if p["status"] != "pending":
        raise HTTPException(409, f"Permit is {p['status']}, not pending")
    owner = conn().execute("SELECT affiliation FROM users WHERE id=?", (p["user_id"],)).fetchone()
    start = now()
    with db.tx(conn()) as c:
        cr = c.execute("SELECT * FROM change_requests WHERE new_permit_id=?", (permit_id,)).fetchone()
        if cr:
            # The old vehicle stays valid until this moment, so the person is never without a permit.
            c.execute("UPDATE permits SET status='inactive', reason='Replaced by vehicle change' WHERE id=?",
                      (cr["old_permit_id"],))
            c.execute("UPDATE change_requests SET status='approved', decided_at=? WHERE id=?", (iso(start), cr["id"]))
        c.execute(
            """UPDATE permits SET status='active', valid_from=?, valid_until=?, decided_by=?, decided_at=?, reason=?
               WHERE id=?""",
            (iso(start), iso(permit_end(owner["affiliation"], start)), user["id"], iso(start), body.reason, permit_id),
        )
        audit(user["id"], "permit_approved", "permit", permit_id, change_request=cr and cr["id"])
    return permit_view(permit_id)


@app.post("/api/v1/admin/permits/{permit_id}/reject")
def reject(permit_id: int, body: DecisionIn, user=Depends(require(*ADMINS))):
    p = _pending_permit(permit_id)
    if p["status"] != "pending":
        raise HTTPException(409, f"Permit is {p['status']}, not pending")
    if not body.reason:
        raise HTTPException(422, "A reason is required when rejecting")
    with db.tx(conn()) as c:
        c.execute("UPDATE permits SET status='rejected', decided_by=?, decided_at=?, reason=? WHERE id=?",
                  (user["id"], iso(now()), body.reason, permit_id))
        c.execute("UPDATE change_requests SET status='rejected', decided_at=? WHERE new_permit_id=?",
                  (iso(now()), permit_id))
        audit(user["id"], "permit_rejected", "permit", permit_id, reason=body.reason)
    return permit_view(permit_id)


@app.post("/api/v1/admin/permits/{permit_id}/suspend")
def suspend(permit_id: int, body: DecisionIn, user=Depends(require(*ADMINS))):
    p = _pending_permit(permit_id)
    if p["status"] != "active":
        raise HTTPException(409, "Only active permits can be suspended")
    if not body.reason:
        raise HTTPException(422, "A reason is required when suspending")
    with db.tx(conn()) as c:
        c.execute("UPDATE permits SET status='suspended', decided_by=?, decided_at=?, reason=? WHERE id=?",
                  (user["id"], iso(now()), body.reason, permit_id))
        audit(user["id"], "permit_suspended", "permit", permit_id, reason=body.reason)
    return permit_view(permit_id)


@app.post("/api/v1/admin/permits/{permit_id}/reinstate")
def reinstate(permit_id: int, body: DecisionIn = DecisionIn(), user=Depends(require(*ADMINS))):
    p = _pending_permit(permit_id)
    if p["status"] != "suspended":
        raise HTTPException(409, "Only suspended permits can be reinstated")
    if p["valid_until"] and p["valid_until"] < iso(now()):
        raise HTTPException(409, "This permit has run out. The person needs to register the vehicle again.")
    if conn().execute(
        "SELECT 1 FROM permits WHERE user_id=? AND status IN ('active','pending') AND id<>?", (p["user_id"], permit_id)
    ).fetchone():
        raise HTTPException(409, "This person already has another active or pending permit")
    vehicle = conn().execute("SELECT plate_normalized FROM vehicles WHERE id=?", (p["vehicle_id"],)).fetchone()
    if plate_taken(vehicle["plate_normalized"], p["user_id"]):
        raise HTTPException(409, "This plate is now registered to another ADA account")
    with db.tx(conn()) as c:
        c.execute("UPDATE permits SET status='active', reason=? WHERE id=?", (body.reason, permit_id))
        audit(user["id"], "permit_reinstated", "permit", permit_id)
    return permit_view(permit_id)


class OverrideIn(BaseModel):
    reason: str = Field(min_length=5, max_length=300)


@app.post("/api/v1/admin/users/{user_id}/cooldown-override", status_code=201)
def grant_override(user_id: int, body: OverrideIn, user=Depends(require(*ADMINS))):
    """Emergency change (car sold, accident, rental): lets the person change once, now."""
    if not conn().execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone():
        raise HTTPException(404, "User not found")
    with db.tx(conn()) as c:
        oid = c.execute(
            "INSERT INTO cooldown_overrides (user_id, reason, granted_by, granted_at) VALUES (?,?,?,?)",
            (user_id, body.reason, user["id"], iso(now())),
        ).lastrowid
        audit(user["id"], "cooldown_override_granted", "user", user_id, reason=body.reason)
    return {"override_id": oid}


TEMPLATES = {
    "move": ("Please move your vehicle", "Your vehicle {plate} needs to be moved. Please contact campus security."),
    "incident": ("Your vehicle was involved in an incident",
                 "Your vehicle {plate} was involved in an incident on campus. Please contact campus security."),
    "lights": ("Your vehicle's lights are on", "The lights on your vehicle {plate} are on."),
}


class ContactIn(BaseModel):
    template: Literal["move", "incident", "lights"]
    plate: str = Field(min_length=3, max_length=16, pattern=PLATE)
    note: Optional[str] = Field(default=None, max_length=500)


@app.post("/api/v1/admin/users/{user_id}/contact", status_code=201)
def contact_owner(user_id: int, body: ContactIn, user=Depends(require(*ADMINS))):
    """Prototype stores the message (shown under the owner's messages); production sends email or a MyADA notice."""
    target = conn().execute("SELECT id, email FROM users WHERE id=?", (user_id,)).fetchone()
    if not target:
        raise HTTPException(404, "User not found")
    subject, text = TEMPLATES[body.template]
    text = text.format(plate=body.plate.upper()) + (f"\n\n{body.note}" if body.note else "")
    with db.tx(conn()) as c:
        mid = c.execute(
            "INSERT INTO messages (to_user_id, from_user_id, subject, body, created_at) VALUES (?,?,?,?,?)",
            (user_id, user["id"], subject, text, iso(now())),
        ).lastrowid
        audit(user["id"], "owner_contacted", "user", user_id, template=body.template, plate=body.plate)
    return {"message_id": mid, "sent_to": target["email"]}


@app.get("/api/v1/admin/audit-log")
def audit_log(user=Depends(require("system_admin"))):
    rows = conn().execute(
        """SELECT a.created_at, u.full_name AS actor, a.action, a.target_type, a.target_id, a.details
           FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200"""
    ).fetchall()
    return [dict(r) for r in rows]


class SettingsIn(BaseModel):
    change_cooldown_days: int = Field(ge=0, le=365)


@app.put("/api/v1/admin/settings")
def update_settings(body: SettingsIn, user=Depends(require("system_admin"))):
    with db.tx(conn()) as c:
        c.execute("UPDATE settings SET value=? WHERE key='change_cooldown_days'", (str(body.change_cooldown_days),))
        audit(user["id"], "settings_changed", change_cooldown_days=body.change_cooldown_days)
    return {"change_cooldown_days": body.change_cooldown_days}


@app.post("/api/v1/admin/jobs/expire")
def run_expiry(user=Depends(require("system_admin"))):
    return {"expired": expire_permits()}


# ---------------------------------------------------------------- web screens

app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _fingerprinted_index() -> str:
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    for name in ("app.css", "app.js"):
        v = hashlib.sha256((STATIC / name).read_bytes()).hexdigest()[:10]
        html = html.replace(f'"/static/{name}"', f'"/static/{name}?v={v}"')
    return html


INDEX_HTML = _fingerprinted_index()


@app.get("/")
def index():
    # Locally the files change while the server runs, so fingerprint them on every load.
    return HTMLResponse(INDEX_HTML if DEPLOYED else _fingerprinted_index(), headers={"Cache-Control": "no-cache"})
