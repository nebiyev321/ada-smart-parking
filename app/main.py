"""Smart Parking: a parking-permit, gate and visitor-pass service for any organisation's site."""
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
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db
from .auth import DEMO_LOGIN, DEPLOYED, current_user, gate_device, issue_token, require

STATIC = Path(__file__).parent / "static"


def _site_zone(offset: str) -> timezone:
    """The site's clock as a fixed UTC offset ("+04:00"), so dates and day passes follow the site, not the server."""
    m = re.fullmatch(r"([+-])(\d{2}):(\d{2})", offset)
    if not m:
        raise RuntimeError(f"PARKING_UTC_OFFSET must look like +04:00, not {offset!r}")
    delta = timedelta(hours=int(m[2]), minutes=int(m[3]))
    return timezone(-delta if m[1] == "-" else delta)


# Defaults to Azerbaijan (+04:00, no daylight saving time), where the service first ran.
SITE_OFFSET = os.environ.get("PARKING_UTC_OFFSET", "+04:00")
SITE_TZ = _site_zone(SITE_OFFSET)
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


def site_today() -> date:
    """Today's date at the site, whatever the server's clock zone."""
    return now().astimezone(SITE_TZ).date()


def site_midnight(day: date) -> str:
    return iso(datetime(day.year, day.month, day.day, tzinfo=SITE_TZ).astimezone(timezone.utc))


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
    title="Smart Parking", version="0.1.0", lifespan=lifespan,
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


def permit_end(start: datetime) -> datetime:
    """A permit runs permit_term_days from its start, or, when permit_fixed_end ("MM-DD") is set, to 23:59 site
    time on the next such day: an academic year ending 30 June, a season, a lease."""
    fixed = setting("permit_fixed_end")
    if not fixed:
        return start + timedelta(days=int(setting("permit_term_days")))
    month, day_ = map(int, fixed.split("-"))
    local = start.astimezone(SITE_TZ)  # 1 July 00:00 at a +04:00 site is still 30 June in UTC
    end = datetime(local.year, month, day_, 23, 59, 59, tzinfo=SITE_TZ)
    if end <= local:
        end = end.replace(year=local.year + 1)
    return end.astimezone(timezone.utc)


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
        """SELECT p.id, p.status, p.valid_from, p.valid_until, p.reason, p.created_at, p.renews_permit_id,
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


# ---------------------------------------------------------------- mocked sign-in

class LoginIn(BaseModel):
    account_id: str = Field(max_length=32)


def demo_login_enabled():
    if not DEMO_LOGIN:
        raise HTTPException(404, "Demo sign-in is turned off. Sign in with your organisation account.")


@app.get("/api/v1/auth/demo-users", dependencies=[Depends(demo_login_enabled)])
def demo_users():
    rows = conn().execute(
        """SELECT u.account_id, u.full_name, u.affiliation, GROUP_CONCAT(r.role) AS roles
           FROM users u LEFT JOIN staff_roles r ON r.user_id=u.id GROUP BY u.id ORDER BY u.id"""
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/v1/auth/mock-login", dependencies=[Depends(demo_login_enabled)])
def mock_login(body: LoginIn):
    user = conn().execute("SELECT id FROM users WHERE account_id=?", (body.account_id,)).fetchone()
    if not user:
        raise HTTPException(404, "No such account")
    return {"token": issue_token(body.account_id)}


# ---------------------------------------------------------------- vehicle owner

class VehicleIn(BaseModel):
    plate: str = Field(min_length=3, max_length=16, pattern=PLATE)
    make: str = Field(min_length=1, max_length=40, pattern=TEXT)
    model: str = Field(min_length=1, max_length=40, pattern=TEXT)
    color: str = Field(min_length=1, max_length=30, pattern=TEXT)


def renewal_state(user_id, active_id, pending_id):
    """Owners can renew once their permit is within the renewal window of its end date."""
    if not active_id:
        return None
    active = conn().execute("SELECT valid_from, valid_until FROM permits WHERE id=?", (active_id,)).fetchone()
    window = int(setting("renewal_window_days"))
    opens = datetime.fromisoformat(active["valid_until"]) - timedelta(days=window)
    pending = permit_view(pending_id)
    return {
        "opens_at": iso(opens),
        "due": now() >= opens,
        "requested": bool(pending and pending["renews_permit_id"] == active_id),
        "next_valid_until": iso(renewed_until(active["valid_until"])),
    }


def renewed_until(valid_until: str) -> datetime:
    """A renewal continues from the moment the current permit ends."""
    return permit_end(datetime.fromisoformat(valid_until) + timedelta(seconds=1))


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
        "renewal": renewal_state(uid, active and active["id"], pending and pending["id"]),
        "user": {k: user[k] for k in ("id", "account_id", "full_name", "email", "affiliation")},
        "roles": sorted(user["roles"]),
        "site_utc_offset": SITE_OFFSET,
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
        raise HTTPException(409, "This plate is already registered to another account")
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


@app.post("/api/v1/me/renewal", status_code=201)
def request_renewal(user=Depends(current_user)):
    """Same vehicle, next term. The parking office approves it; the current permit stays valid meanwhile."""
    uid = user["id"]
    active = conn().execute("SELECT * FROM permits WHERE user_id=? AND status='active'", (uid,)).fetchone()
    if not active:
        raise HTTPException(409, "You need an active permit to renew. Register your vehicle instead.")
    if conn().execute("SELECT 1 FROM permits WHERE user_id=? AND status='pending'", (uid,)).fetchone():
        raise HTTPException(409, "You already have a request waiting for approval")
    state = renewal_state(uid, active["id"], None)
    if not state["due"]:
        raise HTTPException(409, detail={"message": "Renewal opens later", "next_allowed_at": state["opens_at"]})
    with db.tx(conn()) as c:
        pid = c.execute(
            "INSERT INTO permits (user_id, vehicle_id, status, created_at, renews_permit_id) VALUES (?,?, 'pending', ?, ?)",
            (uid, active["vehicle_id"], iso(now()), active["id"]),
        ).lastrowid
        audit(uid, "renewal_requested", "permit", pid, renews=active["id"])
    return permit_view(pid)


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


# ---------------------------------------------------------------- visitor passes

class DecisionIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)



PASSES_PER_DAY = 3
PASS_DAYS_AHEAD = 30


class VisitorPassIn(BaseModel):
    plate: str = Field(min_length=3, max_length=16, pattern=PLATE)
    guest_name: Optional[str] = Field(default=None, max_length=60, pattern=TEXT)
    valid_on: date


def pass_view(row):
    return {k: row[k] for k in ("id", "plate_display", "guest_name", "valid_on", "host", "created_at", "status", "reason")}


PASS_SELECT = """SELECT vp.id, vp.plate_display, vp.guest_name, vp.valid_on, vp.created_at, vp.status, vp.reason,
                        u.full_name AS host, u.affiliation AS host_affiliation
                 FROM visitor_passes vp JOIN users u ON u.id=vp.host_id"""


@app.post("/api/v1/visitor-passes", status_code=201)
def issue_visitor_pass(body: VisitorPassIn, user=Depends(current_user)):
    """Any member can ask to let a guest's car in for a day. Guards or admins approve it first;
    a pass they issue themselves is approved at once. Admins have no daily limit."""
    today = site_today()
    if body.valid_on < today:
        raise HTTPException(422, "Pick today or a later date.")
    if body.valid_on > today + timedelta(days=PASS_DAYS_AHEAD):
        raise HTTPException(422, f"Passes can be issued up to {PASS_DAYS_AHEAD} days ahead.")
    plate_norm = normalize_plate(body.plate)
    if len(plate_norm) < 3:
        raise HTTPException(422, "Plate number looks too short")
    day = body.valid_on.isoformat()
    if conn().execute(
        """SELECT 1 FROM permits p JOIN vehicles v ON v.id=p.vehicle_id
           WHERE v.plate_normalized=? AND p.status='active'""", (plate_norm,)
    ).fetchone():
        raise HTTPException(409, "This plate already has a parking permit, so it doesn't need a visitor pass.")
    if conn().execute(
        """SELECT 1 FROM visitor_passes WHERE plate_normalized=? AND valid_on=? AND revoked_at IS NULL
           AND status<>'rejected'""", (plate_norm, day)
    ).fetchone():
        raise HTTPException(409, "This plate already has a visitor pass for that day.")
    if not user["roles"] & set(ADMINS):
        issued = conn().execute(
            """SELECT COUNT(*) AS n FROM visitor_passes WHERE host_id=? AND valid_on=? AND revoked_at IS NULL
               AND status<>'rejected'""", (user["id"], day)
        ).fetchone()["n"]
        if issued >= PASSES_PER_DAY:
            raise HTTPException(409, f"You can issue up to {PASSES_PER_DAY} visitor passes for one day.")
    staff = bool(user["roles"] & set(STAFF))
    ts = iso(now())
    with db.tx(conn()) as c:
        pid = c.execute(
            """INSERT INTO visitor_passes (host_id, plate_display, plate_normalized, guest_name, valid_on, created_at,
                                           status, decided_by, decided_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (user["id"], body.plate.strip().upper(), plate_norm, (body.guest_name or "").strip() or None, day, ts,
             "approved" if staff else "pending", user["id"] if staff else None, ts if staff else None),
        ).lastrowid
        audit(user["id"], "visitor_pass_issued", "visitor_pass", pid, plate=plate_norm, valid_on=day, needs_approval=not staff)
    return pass_view(conn().execute(PASS_SELECT + " WHERE vp.id=?", (pid,)).fetchone())


@app.get("/api/v1/me/visitor-passes")
def my_visitor_passes(user=Depends(current_user)):
    rows = conn().execute(
        PASS_SELECT + " WHERE vp.host_id=? AND vp.valid_on>=? AND vp.revoked_at IS NULL ORDER BY vp.valid_on, vp.id",
        (user["id"], site_today().isoformat()),
    ).fetchall()
    return [pass_view(r) for r in rows]


@app.get("/api/v1/admin/visitor-passes/pending")
def pending_visitor_passes(user=Depends(require(*STAFF))):
    rows = conn().execute(
        PASS_SELECT + " WHERE vp.status='pending' AND vp.revoked_at IS NULL AND vp.valid_on>=? ORDER BY vp.valid_on, vp.id",
        (site_today().isoformat(),),
    ).fetchall()
    return [dict(pass_view(r), host_affiliation=r["host_affiliation"]) for r in rows]


def _decide_pass(pass_id: int, status: str, user, reason=None):
    vp = conn().execute("SELECT status, revoked_at, valid_on FROM visitor_passes WHERE id=?", (pass_id,)).fetchone()
    if not vp:
        raise HTTPException(404, "Visitor pass not found")
    if vp["revoked_at"]:
        raise HTTPException(409, "The host cancelled this pass")
    if vp["status"] != "pending":
        raise HTTPException(409, f"This pass was already {vp['status']}")
    if vp["valid_on"] < site_today().isoformat():
        raise HTTPException(409, "This pass was for a day that has passed")
    with db.tx(conn()) as c:
        c.execute("UPDATE visitor_passes SET status=?, decided_by=?, decided_at=?, reason=? WHERE id=?",
                  (status, user["id"], iso(now()), reason, pass_id))
        audit(user["id"], f"visitor_pass_{status}", "visitor_pass", pass_id, **({"reason": reason} if reason else {}))
    return pass_view(conn().execute(PASS_SELECT + " WHERE vp.id=?", (pass_id,)).fetchone())


@app.post("/api/v1/admin/visitor-passes/{pass_id}/approve")
def approve_visitor_pass(pass_id: int, user=Depends(require(*STAFF))):
    return _decide_pass(pass_id, "approved", user)


@app.post("/api/v1/admin/visitor-passes/{pass_id}/reject")
def reject_visitor_pass(pass_id: int, body: DecisionIn, user=Depends(require(*STAFF))):
    if not body.reason:
        raise HTTPException(422, "A reason is required when rejecting")
    return _decide_pass(pass_id, "rejected", user, body.reason)


@app.post("/api/v1/visitor-passes/{pass_id}/revoke")
def revoke_visitor_pass(pass_id: int, user=Depends(current_user)):
    vp = conn().execute("SELECT host_id, revoked_at FROM visitor_passes WHERE id=?", (pass_id,)).fetchone()
    if not vp or (vp["host_id"] != user["id"] and not user["roles"] & set(ADMINS)):
        raise HTTPException(404, "Visitor pass not found")
    if vp["revoked_at"]:
        raise HTTPException(409, "This pass was already cancelled")
    with db.tx(conn()) as c:
        c.execute("UPDATE visitor_passes SET revoked_at=? WHERE id=?", (iso(now()), pass_id))
        audit(user["id"], "visitor_pass_revoked", "visitor_pass", pass_id)
    return {"revoked": True}


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
             -- A renewed vehicle has several permits; show only the one that matters now.
             AND p.id = (SELECT p2.id FROM permits p2 WHERE p2.vehicle_id=v.id
                         ORDER BY CASE p2.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
                                  p2.id DESC LIMIT 1)
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
        item["repeat"] = repeat_entries(r["plate_normalized"])
        if not is_admin:
            item.pop("email"), item.pop("phone")
        out.append(item)
    with db.tx(conn()):
        audit(user["id"], "plate_search", query=normalize_plate(plate), results=len(out),
              contact_details_shown=is_admin and bool(out))
    return out


@app.get("/api/v1/admin/vehicles/all")
def all_vehicles(user=Depends(require(*STAFF))):
    """Every registered vehicle with its current permit, active ones first. No contact details here."""
    rows = conn().execute(
        """SELECT v.plate_display, v.make, v.model, v.color, u.full_name, u.affiliation, p.status, p.valid_until
           FROM vehicles v JOIN users u ON u.id=v.owner_id JOIN permits p ON p.vehicle_id=v.id
           WHERE p.id = (SELECT p2.id FROM permits p2 WHERE p2.vehicle_id=v.id
                         ORDER BY CASE p2.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
                                  p2.id DESC LIMIT 1)
           ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END,
                    v.plate_normalized
           LIMIT 2000"""
    ).fetchall()
    with db.tx(conn()):
        audit(user["id"], "vehicle_list_viewed", results=len(rows))
    return [dict(r) for r in rows]


@app.get("/api/v1/admin/flagged-plates")
def flagged_plates(plate: str = Query(min_length=2), user=Depends(require(*STAFF))):
    """Plates with no registered vehicle that came in without a permit or pass three or more times."""
    rows = conn().execute(
        """SELECT g.plate_normalized, MAX(g.plate_display) AS plate_display, COUNT(*) AS n,
                  MIN(g.occurred_at) AS first_at, MAX(g.occurred_at) AS last_at
           FROM gate_events g
           WHERE g.plate_normalized LIKE ? AND g.authorized=0 AND g.direction='in'
             AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.plate_normalized=g.plate_normalized)
           GROUP BY g.plate_normalized HAVING COUNT(*) >= ? ORDER BY n DESC LIMIT 25""",
        (f"%{normalize_plate(plate)}%", REPEAT_THRESHOLD),
    ).fetchall()
    return [dict(r) for r in rows]


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
    visit = None
    if not permit:
        visit = conn().execute(
            PASS_SELECT + " WHERE vp.plate_normalized=? AND vp.valid_on=? AND vp.revoked_at IS NULL AND vp.status=?",
            (plate_norm, site_today().isoformat(), "approved"),
        ).fetchone()
    waiting = None
    if not permit and not visit:
        waiting = conn().execute(
            PASS_SELECT + " WHERE vp.plate_normalized=? AND vp.valid_on=? AND vp.revoked_at IS NULL AND vp.status=?",
            (plate_norm, site_today().isoformat(), "pending"),
        ).fetchone()
    authorized = permit is not None or visit is not None
    # Show the plate as registered when we know it, so "10ab123" at the gate reads "10-AB-123" everywhere.
    display = permit["plate_display"] if permit else visit["plate_display"] if visit else plate.strip().upper()
    with db.tx(conn()) as c:
        eid = c.execute(
            """INSERT INTO gate_events (plate_display, plate_normalized, permit_id, authorized, direction, gate_id,
                                        occurred_at, source, recorded_by, confidence, visitor_pass_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (display, plate_norm, permit and permit["id"], int(authorized), direction, gate_id,
             iso(now()), source, recorded_by, confidence, visit and visit["id"]),
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
        "visitor": visit and {"host": visit["host"], "guest_name": visit["guest_name"]},
        "pending_pass": waiting and {"id": waiting["id"], "host": waiting["host"], "guest_name": waiting["guest_name"]},
        "repeat": None if authorized else repeat_entries(plate_norm),
    }


REPEAT_THRESHOLD = 3


def repeat_entries(plate_norm: str):
    """Entries without a permit or pass. Three or more flag the plate; the gate still never blocks."""
    row = conn().execute(
        """SELECT COUNT(*) AS n, MIN(occurred_at) AS first_at, MAX(occurred_at) AS last_at FROM gate_events
           WHERE plate_normalized=? AND authorized=0 AND direction='in'""",
        (plate_norm,),
    ).fetchone()
    return dict(row) if row["n"] >= REPEAT_THRESHOLD else None


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
                    u.full_name AS owner, host.full_name AS visitor_of, rec.full_name AS recorded_by
             FROM gate_events g
             LEFT JOIN permits p ON p.id=g.permit_id LEFT JOIN users u ON u.id=p.user_id
             LEFT JOIN visitor_passes vp ON vp.id=g.visitor_pass_id LEFT JOIN users host ON host.id=vp.host_id
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


@app.get("/api/v1/admin/on-site")
def on_site(user=Depends(require(*STAFF))):
    """Cars whose latest movement is an entry, oldest first, plus today's expected visitors."""
    today = site_today()
    rows = conn().execute(
        """SELECT g.plate_display, g.plate_normalized, g.occurred_at AS entered_at, g.authorized,
                  u.full_name AS owner, host.full_name AS visitor_of, vp.guest_name
           FROM gate_events g
           LEFT JOIN permits p ON p.id=g.permit_id LEFT JOIN users u ON u.id=p.user_id
           LEFT JOIN visitor_passes vp ON vp.id=g.visitor_pass_id LEFT JOIN users host ON host.id=vp.host_id
           WHERE g.id IN (SELECT MAX(id) FROM gate_events GROUP BY plate_normalized) AND g.direction='in'
           ORDER BY g.occurred_at, g.id"""
    ).fetchall()
    midnight = site_midnight(today)
    inside = [dict(r, authorized=bool(r["authorized"]), overnight=r["entered_at"] < midnight) for r in rows]
    inside_plates = {r["plate_normalized"] for r in inside}
    visitors = conn().execute(
        """SELECT vp.id, vp.plate_display, vp.plate_normalized, vp.guest_name, u.full_name AS host,
                  EXISTS (SELECT 1 FROM gate_events g WHERE g.visitor_pass_id=vp.id) AS arrived
           FROM visitor_passes vp JOIN users u ON u.id=vp.host_id
           WHERE vp.valid_on=? AND vp.revoked_at IS NULL AND vp.status='approved' ORDER BY vp.id""",
        (today.isoformat(),),
    ).fetchall()
    return {
        "inside": inside,
        "visitors_today": [dict(v, arrived=bool(v["arrived"]), inside=v["plate_normalized"] in inside_plates) for v in visitors],
    }


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
                  cr.id AS change_request_id, ov.plate_display AS replaces_plate, p.renews_permit_id
           FROM permits p JOIN users u ON u.id=p.user_id JOIN vehicles v ON v.id=p.vehicle_id
           LEFT JOIN change_requests cr ON cr.new_permit_id=p.id
           LEFT JOIN permits op ON op.id=cr.old_permit_id LEFT JOIN vehicles ov ON ov.id=op.vehicle_id
           WHERE p.status='pending' ORDER BY p.created_at"""
    ).fetchall()
    return [dict(r) for r in rows]


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
    with db.tx(conn()):
        if p["renews_permit_id"]:
            _approve_renewal(p, user["id"])
        else:
            _approve_new(p, user["id"], body.reason)
    return permit_view(permit_id)


def _approve_renewal(p, admin_id):
    """The renewed permit takes over from the current one with no gap; the vehicle and cooldown date carry over."""
    old = conn().execute("SELECT * FROM permits WHERE id=?", (p["renews_permit_id"],)).fetchone()
    if old["status"] != "active":
        raise HTTPException(409, "The permit being renewed is no longer active. The person needs to register again.")
    ts = iso(now())
    conn().execute("UPDATE permits SET status='inactive', reason='Renewed' WHERE id=?", (old["id"],))
    conn().execute(
        "UPDATE permits SET status='active', valid_from=?, valid_until=?, decided_by=?, decided_at=? WHERE id=?",
        (old["valid_from"], iso(renewed_until(old["valid_until"])), admin_id, ts, p["id"]),
    )
    audit(admin_id, "renewal_approved", "permit", p["id"], renews=old["id"])


def _approve_new(p, admin_id, reason):
    permit_id = p["id"]
    start = now()
    c = conn()
    cr = c.execute("SELECT * FROM change_requests WHERE new_permit_id=?", (permit_id,)).fetchone()
    if cr:
        # The old vehicle stays valid until this moment, so the person is never without a permit.
        c.execute("UPDATE permits SET status='inactive', reason='Replaced by vehicle change' WHERE id=?",
                  (cr["old_permit_id"],))
        c.execute("UPDATE change_requests SET status='approved', decided_at=? WHERE id=?", (iso(start), cr["id"]))
    c.execute(
        """UPDATE permits SET status='active', valid_from=?, valid_until=?, decided_by=?, decided_at=?, reason=?
           WHERE id=?""",
        (iso(start), iso(permit_end(start)), admin_id, iso(start), reason, permit_id),
    )
    audit(admin_id, "permit_approved", "permit", permit_id, change_request=cr and cr["id"])


@app.post("/api/v1/admin/renewals/approve-all")
def approve_all_renewals(user=Depends(require(*ADMINS))):
    """Renewals keep the same vehicle, so they need no individual review."""
    pending = conn().execute(
        "SELECT * FROM permits WHERE status='pending' AND renews_permit_id IS NOT NULL ORDER BY id"
    ).fetchall()
    approved, skipped = 0, 0
    for p in pending:
        try:
            with db.tx(conn()):
                _approve_renewal(p, user["id"])
            approved += 1
        except HTTPException:
            skipped += 1
    return {"approved": approved, "skipped": skipped}


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
        raise HTTPException(409, "This plate is now registered to another account")
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
    "move": ("Please move your vehicle", "Your vehicle {plate} needs to be moved. Please contact site security."),
    "incident": ("Your vehicle was involved in an incident",
                 "Your vehicle {plate} was involved in an incident on site. Please contact site security."),
    "lights": ("Your vehicle's lights are on", "The lights on your vehicle {plate} are on."),
}


class ContactIn(BaseModel):
    template: Literal["move", "incident", "lights"]
    plate: str = Field(min_length=3, max_length=16, pattern=PLATE)
    note: Optional[str] = Field(default=None, max_length=500)


@app.post("/api/v1/admin/users/{user_id}/contact", status_code=201)
def contact_owner(user_id: int, body: ContactIn, user=Depends(require(*ADMINS))):
    """Prototype stores the message (shown under the owner's messages); production sends email or an in-app notice."""
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
    renewal_window_days: Optional[int] = Field(default=None, ge=1, le=365)
    permit_term_days: Optional[int] = Field(default=None, ge=1, le=3650)
    # "MM-DD" for a fixed yearly end date, or "" to use permit_term_days.
    permit_fixed_end: Optional[str] = Field(default=None, pattern=r"^(\d{2}-\d{2})?$")


def _check_fixed_end(value: str):
    """Any real calendar day except 29 February, which most years do not have."""
    if not value:
        return
    try:
        date(2025, *map(int, value.split("-")))
    except ValueError:
        raise HTTPException(422, "Pick a real day of the year for the fixed end date.")


def rules():
    return {"change_cooldown_days": int(setting("change_cooldown_days")),
            "renewal_window_days": int(setting("renewal_window_days")),
            "permit_term_days": int(setting("permit_term_days")),
            "permit_fixed_end": setting("permit_fixed_end")}


@app.put("/api/v1/admin/settings")
def update_settings(body: SettingsIn, user=Depends(require("system_admin"))):
    if body.permit_fixed_end is not None:
        _check_fixed_end(body.permit_fixed_end)
    changed = {k: v for k, v in body.model_dump().items() if v is not None}
    with db.tx(conn()) as c:
        for key, value in changed.items():
            c.execute("UPDATE settings SET value=? WHERE key=?", (str(value), key))
        audit(user["id"], "settings_changed", **changed)
    return rules()


@app.get("/api/v1/admin/settings")
def read_settings(user=Depends(require("system_admin"))):
    return rules()


@app.post("/api/v1/admin/jobs/expire")
def run_expiry(user=Depends(require("system_admin"))):
    return {"expired": expire_permits()}


# ---------------------------------------------------------------- web screens

app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _fingerprinted_index() -> str:
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    for name in ("app.css", "prefs.js", "i18n.js", "app.js"):
        v = hashlib.sha256((STATIC / name).read_bytes()).hexdigest()[:10]
        html = html.replace(f'"/static/{name}"', f'"/static/{name}?v={v}"')
    return html


INDEX_HTML = _fingerprinted_index()


# An internal service: keep every page out of search engines.
@app.get("/robots.txt")
def robots():
    return PlainTextResponse("User-agent: *\nDisallow: /\n")


@app.get("/")
def index():
    # Locally the files change while the server runs, so fingerprint them on every load.
    return HTMLResponse(INDEX_HTML if DEPLOYED else _fingerprinted_index(), headers={"Cache-Control": "no-cache"})
