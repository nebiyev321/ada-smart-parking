import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient


TABLES = ["users", "staff_roles", "vehicles", "permits", "cooldown_overrides", "change_requests",
          "gate_events", "messages", "audit_log", "settings"]


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("PARKING_DB", str(tmp_path / "test.db"))
    # Set PARKING_TEST_DATABASE_URL to run against Postgres. Every test wipes that database.
    pg_url = os.environ.get("PARKING_TEST_DATABASE_URL")
    if pg_url:
        import psycopg

        with psycopg.connect(pg_url, autocommit=True) as c:
            c.execute(f"DROP TABLE IF EXISTS {', '.join(TABLES)} CASCADE")
        monkeypatch.setenv("DATABASE_URL", pg_url)
    else:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    import importlib

    from app import db, main

    importlib.reload(db)
    importlib.reload(main)
    clock = {"t": datetime(2026, 10, 7, 9, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(main, "now", lambda: clock["t"])
    with TestClient(main.app) as client:

        def login(myada_id):
            tok = client.post("/api/v1/auth/mock-login", json={"myada_user_id": myada_id}).json()["token"]
            return {"Authorization": f"Bearer {tok}"}

        yield client, login, clock


CAR = {"plate": "10-AB-123", "make": "Toyota", "model": "Corolla", "color": "White"}
CAR2 = {"plate": "90 XY 777", "make": "Kia", "model": "Rio", "color": "Grey"}


def register_and_approve(client, login, who="S1001", car=CAR):
    r = client.post("/api/v1/vehicles", json=car, headers=login(who))
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = client.post(f"/api/v1/admin/permits/{pid}/approve", json={}, headers=login("E3002"))
    assert r.status_code == 200, r.text
    return pid


def test_requires_sign_in(ctx):
    client, _, _ = ctx
    assert client.get("/api/v1/me").status_code == 401
    assert client.get("/api/v1/me", headers={"Authorization": "Bearer bad.token"}).status_code == 401


def test_register_approve_and_one_vehicle_limit(ctx):
    client, login, _ = ctx
    pid = register_and_approve(client, login)
    me = client.get("/api/v1/me", headers=login("S1001")).json()
    assert me["active_permit"]["id"] == pid
    assert me["active_permit"]["plate_normalized"] == "10AB123"
    assert me["active_permit"]["valid_until"].startswith("2027-06-30")  # end of academic year
    # Second registration is refused: only one active vehicle per person.
    assert client.post("/api/v1/vehicles", json=CAR2, headers=login("S1001")).status_code == 409


def test_plate_cannot_belong_to_two_people(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    r = client.post("/api/v1/vehicles", json={**CAR, "plate": "10 ab 123"}, headers=login("S1002"))
    assert r.status_code == 409


def test_change_blocked_during_cooldown_then_allowed(ctx):
    client, login, clock = ctx
    register_and_approve(client, login)
    r = client.post("/api/v1/change-requests", json=CAR2, headers=login("S1001"))
    assert r.status_code == 409
    assert r.json()["detail"]["next_allowed_at"].startswith("2027-01-05")  # 90 days later

    clock["t"] += timedelta(days=91)
    r = client.post("/api/v1/change-requests", json=CAR2, headers=login("S1001"))
    assert r.status_code == 201, r.text
    new_pid = r.json()["permit"]["id"]
    # Old vehicle stays active while the change waits for approval.
    me = client.get("/api/v1/me", headers=login("S1001")).json()
    assert me["active_permit"]["plate_normalized"] == "10AB123"
    assert me["pending_permit"]["id"] == new_pid

    client.post(f"/api/v1/admin/permits/{new_pid}/approve", json={}, headers=login("E3002"))
    me = client.get("/api/v1/me", headers=login("S1001")).json()
    assert me["active_permit"]["plate_normalized"] == "90XY777"
    assert me["change"]["allowed_now"] is False  # cooldown restarts


def test_admin_override_allows_one_emergency_change(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    uid = client.get("/api/v1/me", headers=login("S1001")).json()["user"]["id"]
    r = client.post(f"/api/v1/admin/users/{uid}/cooldown-override", json={"reason": "Car sold"},
                    headers=login("E3002"))
    assert r.status_code == 201
    assert client.post("/api/v1/change-requests", json=CAR2, headers=login("S1001")).status_code == 201


def test_rejected_change_keeps_old_vehicle(ctx):
    client, login, clock = ctx
    register_and_approve(client, login)
    clock["t"] += timedelta(days=100)
    new_pid = client.post("/api/v1/change-requests", json=CAR2, headers=login("S1001")).json()["permit"]["id"]
    assert client.post(f"/api/v1/admin/permits/{new_pid}/reject", json={}, headers=login("E3002")).status_code == 422
    client.post(f"/api/v1/admin/permits/{new_pid}/reject", json={"reason": "Document unreadable"},
                headers=login("E3002"))
    me = client.get("/api/v1/me", headers=login("S1001")).json()
    assert me["active_permit"]["plate_normalized"] == "10AB123"


def test_guard_search_hides_contact_details_admin_sees_them(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    guard = client.get("/api/v1/admin/vehicles?plate=ab12", headers=login("E3001")).json()
    assert guard[0]["full_name"] == "Leyla Mammadova" and "phone" not in guard[0]
    admin = client.get("/api/v1/admin/vehicles?plate=ab12", headers=login("E3002")).json()
    assert admin[0]["phone"]
    # Students cannot search.
    assert client.get("/api/v1/admin/vehicles?plate=ab12", headers=login("S1002")).status_code == 403


def test_gate_logging_and_authorization(ctx):
    client, login, clock = ctx
    register_and_approve(client, login)
    g = login("E3001")
    r = client.post("/api/v1/admin/gate-events", json={"plate": "10ab123", "direction": "in"}, headers=g).json()
    assert r["authorized"] and r["owner"] == "Leyla Mammadova"
    clock["t"] += timedelta(hours=8)
    client.post("/api/v1/admin/gate-events", json={"plate": "10-AB-123", "direction": "out"}, headers=g)
    r = client.post("/api/v1/admin/gate-events", json={"plate": "77ZZ001", "direction": "in"}, headers=g).json()
    assert r["authorized"] is False and r["decision"] == "check"

    log = client.get("/api/v1/admin/gate-events?plate=10AB", headers=g).json()
    assert [e["direction"] for e in log] == ["out", "in"]
    mine = client.get("/api/v1/me/gate-events", headers=login("S1001")).json()
    assert len(mine) == 2
    csv = client.get("/api/v1/admin/gate-events?format=csv", headers=g)
    assert csv.text.count("\n") == 4  # header + 3 events


def test_suspended_permit_is_not_authorized_at_gate(ctx):
    client, login, _ = ctx
    pid = register_and_approve(client, login)
    client.post(f"/api/v1/admin/permits/{pid}/suspend", json={"reason": "Parking violation"}, headers=login("E3002"))
    r = client.post("/api/v1/admin/gate-events", json={"plate": "10AB123", "direction": "in"},
                    headers=login("E3001")).json()
    assert r["authorized"] is False


def test_permits_expire(ctx):
    client, login, clock = ctx
    register_and_approve(client, login)
    clock["t"] = datetime(2027, 7, 1, tzinfo=timezone.utc)
    assert client.post("/api/v1/admin/jobs/expire", headers=login("E3003")).json()["expired"] == 1
    me = client.get("/api/v1/me", headers=login("S1001")).json()
    assert me["active_permit"] is None and me["latest_inactive_permit"]["status"] == "expired"
    # Expired users can register again.
    assert client.post("/api/v1/vehicles", json=CAR, headers=login("S1001")).status_code == 201


def test_contact_owner_and_audit(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    uid = client.get("/api/v1/me", headers=login("S1001")).json()["user"]["id"]
    r = client.post(f"/api/v1/admin/users/{uid}/contact", json={"template": "move", "plate": "10AB123"},
                    headers=login("E3002"))
    assert r.status_code == 201
    msgs = client.get("/api/v1/me/messages", headers=login("S1001")).json()
    assert msgs[0]["subject"] == "Please move your vehicle"
    actions = [a["action"] for a in client.get("/api/v1/admin/audit-log", headers=login("E3003")).json()]
    assert "owner_contacted" in actions and "permit_approved" in actions
    assert client.get("/api/v1/admin/audit-log", headers=login("E3002")).status_code == 403


def test_gate_device_endpoint_needs_key(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    body = {"plate": "10AB123", "direction": "in", "source": "anpr", "confidence": 0.95}
    assert client.post("/api/v1/gate/reads", json=body).status_code == 401
    r = client.post("/api/v1/gate/reads", json=body, headers={"X-Gate-Key": "dev-gate-key"}).json()
    assert r["decision"] == "allow"
    r = client.post("/api/v1/gate/reads", json={**body, "confidence": 0.5},
                    headers={"X-Gate-Key": "dev-gate-key"}).json()
    assert r["decision"] == "check"


def test_malformed_tokens_are_rejected_not_crashing(ctx):
    client, _, _ = ctx
    for tok in ("a.b.c", "!!!.sig", "e30.sig"):
        assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401
    assert client.post("/api/v1/gate/reads", json={"plate": "10AB123", "direction": "in"},
                       headers={"X-Gate-Key": "ключ".encode()}).status_code == 401


def test_plate_and_text_fields_are_validated(ctx):
    client, login, _ = ctx
    s = login("S1001")
    for plate in ("10AB');alert(1)//", "<b>10AB</b>", "10--AB"):
        assert client.post("/api/v1/vehicles", json={**CAR, "plate": plate}, headers=s).status_code == 422
    assert client.post("/api/v1/vehicles", json={**CAR, "make": "<script>"}, headers=s).status_code == 422


def test_suspended_owner_cannot_register_around_suspension(ctx):
    client, login, _ = ctx
    pid = register_and_approve(client, login)
    client.post(f"/api/v1/admin/permits/{pid}/suspend", json={"reason": "Parking violation"}, headers=login("E3002"))
    r = client.post("/api/v1/vehicles", json=CAR, headers=login("S1001"))
    assert r.status_code == 409 and "suspended" in r.json()["detail"]


def test_reinstate_refused_when_plate_now_belongs_to_someone_else(ctx):
    client, login, _ = ctx
    pid = register_and_approve(client, login)
    client.post(f"/api/v1/admin/permits/{pid}/suspend", json={"reason": "Car sold"}, headers=login("E3002"))
    register_and_approve(client, login, who="S1002")  # new owner registers the same plate
    r = client.post(f"/api/v1/admin/permits/{pid}/reinstate", json={}, headers=login("E3002"))
    assert r.status_code == 409


def test_security_headers_and_csv_formula_guard(ctx):
    client, _, _ = ctx
    r = client.get("/")
    assert "script-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
    from app import main

    assert main.csv_safe("=HYPERLINK(1)") == "'=HYPERLINK(1)" and main.csv_safe("10AB123") == "10AB123"


def test_demo_login_can_be_turned_off(ctx, monkeypatch):
    client, _, _ = ctx
    from app import main

    monkeypatch.setattr(main, "DEMO_LOGIN", False)
    assert client.get("/api/v1/auth/demo-users").status_code == 404
    assert client.post("/api/v1/auth/mock-login", json={"myada_user_id": "E3003"}).status_code == 404


def test_api_docs_hidden_when_deployed(monkeypatch, tmp_path):
    monkeypatch.setenv("PARKING_DB", str(tmp_path / "docs.db"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("PARKING_SECRET", "s")
    monkeypatch.setenv("PARKING_GATE_KEY", "k")
    import importlib

    from app import auth, db, main

    try:
        importlib.reload(auth), importlib.reload(db), importlib.reload(main)
        with TestClient(main.app) as client:
            assert client.get("/docs").status_code == 404
            assert client.get("/openapi.json").status_code == 404
            assert client.get("/api/v1/auth/demo-users").status_code == 404  # demo sign-in off too
    finally:
        monkeypatch.undo()
        importlib.reload(auth), importlib.reload(db), importlib.reload(main)


def test_gate_shows_plate_as_registered(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    r = client.post("/api/v1/admin/gate-events", json={"plate": "10ab123", "direction": "in"}, headers=login("E3001"))
    assert r.json()["plate_display"] == "10-AB-123"
    log = client.get("/api/v1/admin/gate-events", headers=login("E3001")).json()
    assert log[0]["plate_display"] == "10-AB-123"
    r = client.post("/api/v1/admin/gate-events", json={"plate": "77 zz 777", "direction": "in"}, headers=login("E3001"))
    assert r.json()["plate_display"] == "77 ZZ 777"


def test_static_assets_are_fingerprinted(ctx):
    client, _, _ = ctx
    page = client.get("/")
    assert page.headers["cache-control"] == "no-cache"
    import re
    js = re.search(r'src="(/static/app\.js\?v=[0-9a-f]{10})"', page.text).group(1)
    assert "immutable" in client.get(js).headers["cache-control"]
    assert client.get("/static/app.js").headers["cache-control"] == "no-cache"


def test_parallel_requests_do_not_share_a_cursor(ctx):
    # The owner page loads gate events and messages at the same time.
    client, login, _ = ctx
    register_and_approve(client, login)
    h = login("S1001")
    from concurrent.futures import ThreadPoolExecutor

    paths = ["/api/v1/me/gate-events", "/api/v1/me/messages", "/api/v1/me"] * 30
    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(lambda p: client.get(p, headers=h).status_code, paths))
    assert set(codes) == {200}
