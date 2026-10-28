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

        def login(account_id):
            tok = client.post("/api/v1/auth/mock-login", json={"account_id": account_id}).json()["token"]
            return {"Authorization": f"Bearer {tok}"}

        yield client, login, clock


CAR = {"plate": "10-AB-123", "make": "Toyota", "model": "Corolla", "color": "White"}
CAR2 = {"plate": "90 XY 777", "make": "Kia", "model": "Rio", "color": "Grey"}


def register_and_approve(client, login, who="M1001", car=CAR):
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
    me = client.get("/api/v1/me", headers=login("M1001")).json()
    assert me["active_permit"]["id"] == pid
    assert me["active_permit"]["plate_normalized"] == "10AB123"
    assert me["active_permit"]["valid_until"].startswith("2027-10-07")  # the default term: 365 days
    # Second registration is refused: only one active vehicle per person.
    assert client.post("/api/v1/vehicles", json=CAR2, headers=login("M1001")).status_code == 409


def test_plate_cannot_belong_to_two_people(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    r = client.post("/api/v1/vehicles", json={**CAR, "plate": "10 ab 123"}, headers=login("M1002"))
    assert r.status_code == 409


def test_change_blocked_during_cooldown_then_allowed(ctx):
    client, login, clock = ctx
    register_and_approve(client, login)
    r = client.post("/api/v1/change-requests", json=CAR2, headers=login("M1001"))
    assert r.status_code == 409
    assert r.json()["detail"]["next_allowed_at"].startswith("2027-01-05")  # 90 days later

    clock["t"] += timedelta(days=91)
    r = client.post("/api/v1/change-requests", json=CAR2, headers=login("M1001"))
    assert r.status_code == 201, r.text
    new_pid = r.json()["permit"]["id"]
    # Old vehicle stays active while the change waits for approval.
    me = client.get("/api/v1/me", headers=login("M1001")).json()
    assert me["active_permit"]["plate_normalized"] == "10AB123"
    assert me["pending_permit"]["id"] == new_pid

    client.post(f"/api/v1/admin/permits/{new_pid}/approve", json={}, headers=login("E3002"))
    me = client.get("/api/v1/me", headers=login("M1001")).json()
    assert me["active_permit"]["plate_normalized"] == "90XY777"
    assert me["change"]["allowed_now"] is False  # cooldown restarts


def test_admin_override_allows_one_emergency_change(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    uid = client.get("/api/v1/me", headers=login("M1001")).json()["user"]["id"]
    r = client.post(f"/api/v1/admin/users/{uid}/cooldown-override", json={"reason": "Car sold"},
                    headers=login("E3002"))
    assert r.status_code == 201
    assert client.post("/api/v1/change-requests", json=CAR2, headers=login("M1001")).status_code == 201


def test_rejected_change_keeps_old_vehicle(ctx):
    client, login, clock = ctx
    register_and_approve(client, login)
    clock["t"] += timedelta(days=100)
    new_pid = client.post("/api/v1/change-requests", json=CAR2, headers=login("M1001")).json()["permit"]["id"]
    assert client.post(f"/api/v1/admin/permits/{new_pid}/reject", json={}, headers=login("E3002")).status_code == 422
    client.post(f"/api/v1/admin/permits/{new_pid}/reject", json={"reason": "Document unreadable"},
                headers=login("E3002"))
    me = client.get("/api/v1/me", headers=login("M1001")).json()
    assert me["active_permit"]["plate_normalized"] == "10AB123"


def test_guard_search_hides_contact_details_admin_sees_them(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    guard = client.get("/api/v1/admin/vehicles?plate=ab12", headers=login("E3001")).json()
    assert guard[0]["full_name"] == "Leyla Mammadova" and "phone" not in guard[0]
    admin = client.get("/api/v1/admin/vehicles?plate=ab12", headers=login("E3002")).json()
    assert admin[0]["phone"]
    # Students cannot search.
    assert client.get("/api/v1/admin/vehicles?plate=ab12", headers=login("M1002")).status_code == 403


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
    mine = client.get("/api/v1/me/gate-events", headers=login("M1001")).json()
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
    clock["t"] = datetime(2027, 10, 8, tzinfo=timezone.utc)
    assert client.post("/api/v1/admin/jobs/expire", headers=login("E3003")).json()["expired"] == 1
    me = client.get("/api/v1/me", headers=login("M1001")).json()
    assert me["active_permit"] is None and me["latest_inactive_permit"]["status"] == "expired"
    # Expired users can register again.
    assert client.post("/api/v1/vehicles", json=CAR, headers=login("M1001")).status_code == 201


def test_contact_owner_and_audit(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    uid = client.get("/api/v1/me", headers=login("M1001")).json()["user"]["id"]
    r = client.post(f"/api/v1/admin/users/{uid}/contact", json={"template": "move", "plate": "10AB123"},
                    headers=login("E3002"))
    assert r.status_code == 201
    msgs = client.get("/api/v1/me/messages", headers=login("M1001")).json()
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
    s = login("M1001")
    for plate in ("10AB');alert(1)//", "<b>10AB</b>", "10--AB"):
        assert client.post("/api/v1/vehicles", json={**CAR, "plate": plate}, headers=s).status_code == 422
    assert client.post("/api/v1/vehicles", json={**CAR, "make": "<script>"}, headers=s).status_code == 422


def test_suspended_owner_cannot_register_around_suspension(ctx):
    client, login, _ = ctx
    pid = register_and_approve(client, login)
    client.post(f"/api/v1/admin/permits/{pid}/suspend", json={"reason": "Parking violation"}, headers=login("E3002"))
    r = client.post("/api/v1/vehicles", json=CAR, headers=login("M1001"))
    assert r.status_code == 409 and "suspended" in r.json()["detail"]


def test_reinstate_refused_when_plate_now_belongs_to_someone_else(ctx):
    client, login, _ = ctx
    pid = register_and_approve(client, login)
    client.post(f"/api/v1/admin/permits/{pid}/suspend", json={"reason": "Car sold"}, headers=login("E3002"))
    register_and_approve(client, login, who="M1002")  # new owner registers the same plate
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
    assert client.post("/api/v1/auth/mock-login", json={"account_id": "E3003"}).status_code == 404


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


def test_robots_keeps_the_site_out_of_search(ctx):
    client, _, _ = ctx
    r = client.get("/robots.txt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert r.text == "User-agent: *\nDisallow: /\n"


def test_parallel_requests_do_not_share_a_cursor(ctx):
    # The owner page loads gate events and messages at the same time.
    client, login, _ = ctx
    register_and_approve(client, login)
    h = login("M1001")
    from concurrent.futures import ThreadPoolExecutor

    paths = ["/api/v1/me/gate-events", "/api/v1/me/messages", "/api/v1/me"] * 30
    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(lambda p: client.get(p, headers=h).status_code, paths))
    assert set(codes) == {200}


def test_visitor_pass_lets_a_guest_in_for_that_day_only(ctx):
    client, login, clock = ctx
    g = login("E3001")
    today = "2026-10-07"
    r = client.post("/api/v1/visitor-passes", json={"plate": "77-zz-001", "guest_name": "Kamran", "valid_on": today},
                    headers=login("M1001"))
    assert r.status_code == 201, r.text
    mine = client.get("/api/v1/me/visitor-passes", headers=login("M1001")).json()[0]
    assert mine["plate_display"] == "77-ZZ-001" and mine["status"] == "pending"
    # Until a guard or admin approves it, the gate checks the car and says a pass is waiting.
    r = client.post("/api/v1/admin/gate-events", json={"plate": "77ZZ001", "direction": "in"}, headers=g).json()
    assert r["authorized"] is False and r["pending_pass"]["host"] == "Leyla Mammadova"
    assert client.get("/api/v1/admin/visitor-passes/pending", headers=g).json()[0]["id"] == mine["id"]
    assert client.post(f"/api/v1/admin/visitor-passes/{mine['id']}/approve", headers=g).status_code == 200
    r = client.post("/api/v1/admin/gate-events", json={"plate": "77ZZ001", "direction": "in"}, headers=g).json()
    assert r["authorized"] and r["visitor"] == {"host": "Leyla Mammadova", "guest_name": "Kamran"}
    log = client.get("/api/v1/admin/gate-events", headers=g).json()
    assert log[0]["visitor_of"] == "Leyla Mammadova"
    # The next day the same plate is checked again.
    clock["t"] += timedelta(days=1)
    r = client.post("/api/v1/admin/gate-events", json={"plate": "77ZZ001", "direction": "in"}, headers=g).json()
    assert r["authorized"] is False


def test_visitor_pass_rules(ctx):
    client, login, _ = ctx
    owner = login("M1002")
    past = client.post("/api/v1/visitor-passes", json={"plate": "77ZZ001", "valid_on": "2026-10-06"}, headers=owner)
    assert past.status_code == 422
    for n in range(3):
        assert client.post("/api/v1/visitor-passes", json={"plate": f"77ZZ00{n}", "valid_on": "2026-10-08"},
                           headers=owner).status_code == 201
    over = client.post("/api/v1/visitor-passes", json={"plate": "77ZZ009", "valid_on": "2026-10-08"}, headers=owner)
    assert over.status_code == 409
    # Someone else's pass cannot be cancelled; your own can, and the gate then checks the car.
    pid = client.get("/api/v1/me/visitor-passes", headers=owner).json()[0]["id"]
    assert client.post(f"/api/v1/visitor-passes/{pid}/revoke", headers=login("M1001")).status_code == 404
    assert client.post(f"/api/v1/visitor-passes/{pid}/revoke", headers=owner).status_code == 200
    register_and_approve(client, login)
    taken = client.post("/api/v1/visitor-passes", json={"plate": "10AB123", "valid_on": "2026-10-08"}, headers=owner)
    assert taken.status_code == 409


def test_on_campus_lists_cars_still_inside_and_flags_overnight(ctx):
    client, login, clock = ctx
    register_and_approve(client, login)
    g = login("E3001")
    client.post("/api/v1/admin/gate-events", json={"plate": "10AB123", "direction": "in"}, headers=g)
    client.post("/api/v1/admin/gate-events", json={"plate": "77ZZ001", "direction": "in"}, headers=g)
    client.post("/api/v1/admin/gate-events", json={"plate": "77ZZ001", "direction": "out"}, headers=g)
    clock["t"] += timedelta(days=1)
    client.post("/api/v1/admin/gate-events", json={"plate": "55QQ555", "direction": "in"}, headers=g)
    inside = client.get("/api/v1/admin/on-site", headers=g).json()["inside"]
    assert [(c["plate_display"], c["overnight"], c["authorized"]) for c in inside] == [
        ("10-AB-123", True, True), ("55QQ555", False, False)]
    assert client.get("/api/v1/admin/on-site", headers=login("M1001")).status_code == 403


def test_renewal_opens_near_the_end_and_continues_the_permit(ctx):
    client, login, clock = ctx
    # A site on an academic year: every permit ends on 30 June.
    r = client.put("/api/v1/admin/settings", json={"change_cooldown_days": 90, "permit_fixed_end": "06-30"},
                   headers=login("E3003"))
    assert r.status_code == 200 and r.json()["permit_fixed_end"] == "06-30"
    pid = register_and_approve(client, login)
    owner = login("M1001")
    assert client.get("/api/v1/me", headers=owner).json()["renewal"]["due"] is False
    assert client.post("/api/v1/me/renewal", headers=owner).status_code == 409
    clock["t"] = datetime(2027, 6, 10, tzinfo=timezone.utc)
    assert client.get("/api/v1/me", headers=owner).json()["renewal"]["due"] is True
    r = client.post("/api/v1/me/renewal", headers=owner)
    assert r.status_code == 201, r.text
    queue = client.get("/api/v1/admin/queue", headers=login("E3002")).json()
    assert queue[0]["renews_permit_id"] == pid
    assert client.post("/api/v1/admin/renewals/approve-all", headers=login("E3002")).json() == {"approved": 1, "skipped": 0}
    me = client.get("/api/v1/me", headers=owner).json()
    # Next term runs to 30 June 2028 (23:59 site time, +04:00), and the old permit is no longer the active one.
    assert me["active_permit"]["valid_until"] == "2028-06-30T19:59:59+00:00"
    assert me["active_permit"]["id"] != pid
    found = client.get("/api/v1/admin/vehicles?plate=10AB", headers=login("E3001")).json()
    assert len(found) == 1 and found[0]["status"] == "active"


def test_repeat_entries_without_permit_are_flagged(ctx):
    client, login, clock = ctx
    g = login("E3001")
    for n in range(3):
        r = client.post("/api/v1/admin/gate-events", json={"plate": "99ZZ001", "direction": "in"}, headers=g).json()
        assert (r["repeat"] is None) == (n < 2)
        clock["t"] += timedelta(hours=1)
    assert r["repeat"]["n"] == 3
    flagged = client.get("/api/v1/admin/flagged-plates?plate=99ZZ", headers=g).json()
    assert flagged[0]["plate_normalized"] == "99ZZ001" and flagged[0]["n"] == 3


def test_visitor_pass_approval_rules(ctx):
    client, login, _ = ctx
    owner = login("M1002")
    pid = client.post("/api/v1/visitor-passes", json={"plate": "55QQ555", "valid_on": "2026-10-07"}, headers=owner).json()["id"]
    # Owners cannot approve; a reason is needed to reject; a decided pass cannot be decided again.
    assert client.post(f"/api/v1/admin/visitor-passes/{pid}/approve", headers=login("M1001")).status_code == 403
    assert client.post(f"/api/v1/admin/visitor-passes/{pid}/reject", json={}, headers=login("E3001")).status_code == 422
    r = client.post(f"/api/v1/admin/visitor-passes/{pid}/reject", json={"reason": "Event cancelled"}, headers=login("E3001"))
    assert r.json()["status"] == "rejected"
    assert client.post(f"/api/v1/admin/visitor-passes/{pid}/approve", headers=login("E3002")).status_code == 409
    assert client.get("/api/v1/me/visitor-passes", headers=owner).json()[0]["reason"] == "Event cancelled"
    # A rejected pass frees the plate for another request; a pass a guard issues is approved at once.
    r = client.post("/api/v1/visitor-passes", json={"plate": "55QQ555", "valid_on": "2026-10-07"}, headers=login("E3001"))
    assert r.status_code == 201 and r.json()["status"] == "approved"


def test_all_registered_vehicles_list(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    client.post("/api/v1/vehicles", json=CAR2, headers=login("M1002"))
    rows = client.get("/api/v1/admin/vehicles/all", headers=login("E3001")).json()
    assert [(r["plate_display"], r["status"]) for r in rows] == [("10-AB-123", "active"), ("90 XY 777", "pending")]
    assert "email" not in rows[0] and "phone" not in rows[0]
    assert client.get("/api/v1/admin/vehicles/all", headers=login("M1001")).status_code == 403


# XSS regressions. The client escapes every value it puts into HTML; these tests pin the server-side
# half: the page shell has nothing inline for an injection to ride on, the CSP forbids inline script,
# API data is only ever served as JSON, and free text is stored verbatim (escaping happens on output).
# tests/browser/xss_dom_check.mjs covers the rendering half in a real browser.
PROBE = '"><i data-xss-probe="1">probe</i>'


def test_csp_forbids_inline_script_and_plugins(ctx):
    client, _, _ = ctx
    csp = client.get("/").headers["content-security-policy"]
    directives = dict(d.strip().split(" ", 1) for d in csp.split(";") if d.strip())
    assert directives["script-src"] == "'self'"
    assert "unsafe-inline" not in csp and "unsafe-eval" not in csp
    for name, value in {"object-src": "'none'", "base-uri": "'none'", "frame-ancestors": "'none'", "form-action": "'self'"}.items():
        assert directives[name] == value
    assert directives["img-src"] == "'self' data:" and directives["connect-src"] == "'self'"


def test_page_shell_has_nothing_inline(ctx):
    import re
    client, _, _ = ctx
    html = client.get("/").text
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html), "inline <script> in the page shell"
    assert not re.search(r"\son[a-z]+\s*=", html, re.I), "inline event handler in the page shell"
    assert not re.search(r"\sstyle\s*=", html, re.I), "inline style attribute in the page shell"
    assert "javascript:" not in html.lower()


def test_api_data_is_served_as_json_and_never_sniffed(ctx):
    client, login, _ = ctx
    register_and_approve(client, login)
    for path, who in [("/api/v1/me", "M1001"), ("/api/v1/admin/vehicles/all", "E3001"), ("/api/v1/admin/gate-events", "E3001")]:
        r = client.get(path, headers=login(who))
        assert r.headers["content-type"].startswith("application/json")
        assert r.headers["x-content-type-options"] == "nosniff"
    # Error bodies are JSON too, so a reflected plate can't become a page.
    r = client.get("/api/v1/admin/vehicles?plate=" + PROBE, headers=login("E3001"))
    assert r.headers["content-type"].startswith("application/json")
    csv = client.get("/api/v1/admin/gate-events?format=csv", headers=login("E3001"))
    assert csv.headers["content-type"].startswith("text/csv") and "attachment" in csv.headers["content-disposition"]


def test_free_text_is_stored_verbatim_for_the_client_to_escape(ctx):
    client, login, _ = ctx
    r = client.post("/api/v1/vehicles", json=CAR, headers=login("M1001"))
    client.post(f"/api/v1/admin/permits/{r.json()['id']}/reject", json={"reason": PROBE}, headers=login("E3002"))
    me = client.get("/api/v1/me", headers=login("M1001")).json()
    assert me["latest_inactive_permit"]["reason"] == PROBE


def test_short_text_fields_reject_markup(ctx):
    client, login, _ = ctx
    bad_car = dict(CAR, make='<i data-xss-probe="1">')
    assert client.post("/api/v1/vehicles", json=bad_car, headers=login("M1001")).status_code == 422
    bad_pass = {"plate": "77ZZ001", "guest_name": "<i>", "valid_on": "2026-10-07"}
    assert client.post("/api/v1/visitor-passes", json=bad_pass, headers=login("M1001")).status_code == 422
    assert client.post("/api/v1/vehicles", json=dict(CAR, plate='10"><i>'), headers=login("M1001")).status_code == 422


def test_client_escape_helper_covers_html_and_attributes():
    """Runs the real esc() from app.js under Node; skipped where Node isn't installed."""
    import json
    import re
    import shutil
    import subprocess
    from pathlib import Path

    node = shutil.which("node")
    if not node:
        pytest.skip("Node is not installed")
    src = (Path(__file__).parent.parent / "app" / "static" / "app.js").read_text(encoding="utf-8")
    esc = re.search(r"^const esc = .*$", src, re.M).group(0)
    script = esc + "\nprocess.stdout.write(JSON.stringify([esc(`<&>\"'`), esc(null), esc(undefined), esc(0)]));"
    out = subprocess.run([node, "-e", script], capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == ["&lt;&amp;&gt;&quot;&#39;", "", "", "0"]


def test_every_interface_string_has_an_azerbaijani_translation():
    """Static check: what the interface translates, and what the server can say, all have AZ entries."""
    import re
    from pathlib import Path

    root = Path(__file__).parent.parent
    i18n = (root / "app" / "static" / "i18n.js").read_text(encoding="utf-8")
    app = (root / "app" / "static" / "app.js").read_text(encoding="utf-8")
    server = (root / "app" / "main.py").read_text(encoding="utf-8") + (root / "app" / "auth.py").read_text(encoding="utf-8")
    az_block = i18n[i18n.index("const AZ = {"):i18n.index("\n};")]
    keys = {m.group(1).replace('\\"', '"') for m in re.finditer(r'^\s*"((?:[^"\\]|\\.)*)":\s*"', az_block, re.M)}

    used = set(re.findall(r'\bt\("((?:[^"\\]|\\.)*)"', app))
    for a, b in re.findall(r'\bt\([^()"]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"', app):  # t(cond ? "a" : "b")
        used |= {a, b}
    for name in ("STATUS", "FIELD_NAMES"):
        block = re.search(rf"const {name} = \{{(.*?)\}};", app, re.S).group(1)
        used |= set(re.findall(r':\s*"([^"]+)"', block))
    used |= set(re.findall(r'label: "([^"]+)", icon', app))                              # section names
    used |= set(re.findall(r'\["(?:pending|active|rejected)", "([^"]+)"\]', app))          # visitor pass statuses
    for cols in re.findall(r'table\(\s*\[([^\]]*)\]', app):                                # table columns
        used |= {c for c in re.findall(r'"([^"]*)"', cols) if c}
    missing = sorted(used - keys)
    assert not missing, f"app.js strings with no Azerbaijani: {missing}"

    said = set(re.findall(r'HTTPException\(\d+,\s*"([^"]+)"', server))
    said |= set(re.findall(r'"message":\s*"([^"]+)"', server))
    said |= set(re.findall(r'"(?:active|pending|suspended)":\s*"([^"]+)"', server))
    said |= {"This conflicts with a change made a moment ago. Refresh and try again."}
    missing = sorted(said - keys)
    assert not missing, f"server messages with no Azerbaijani: {missing}"

    codes = set(re.findall(r'audit\([^,]+,\s*"([a-z_]+)"', server)) | {"visitor_pass_approved", "visitor_pass_rejected"}
    codes |= {"member", "contractor", "staff", "guard", "parking_admin", "system_admin", "permit", "user", "change_request", "visitor_pass"}
    labels = {c.replace("_", " ").capitalize() for c in codes}
    missing = sorted(labels - keys)
    assert not missing, f"codes shown as words with no Azerbaijani: {missing}"


def test_permit_length_is_a_setting(ctx):
    client, login, _ = ctx
    admin = login("E3003")
    r = client.put("/api/v1/admin/settings", json={"change_cooldown_days": 90, "permit_term_days": 30}, headers=admin)
    assert r.status_code == 200 and r.json()["permit_term_days"] == 30
    register_and_approve(client, login)
    me = client.get("/api/v1/me", headers=login("M1001")).json()
    assert me["active_permit"]["valid_until"].startswith("2026-11-06")
    # Not a real day, and 29 February, are refused; an empty value switches the fixed end off.
    for bad in ("02-30", "13-01", "02-29"):
        assert client.put("/api/v1/admin/settings", json={"change_cooldown_days": 90, "permit_fixed_end": bad},
                          headers=admin).status_code == 422
    assert client.put("/api/v1/admin/settings", json={"change_cooldown_days": 90, "permit_fixed_end": ""},
                      headers=admin).json()["permit_fixed_end"] == ""
    assert client.put("/api/v1/admin/settings", json={"change_cooldown_days": 90, "permit_term_days": 30},
                      headers=login("E3002")).status_code == 403


def test_campus_release_database_is_migrated(tmp_path, monkeypatch):
    """A database from the campus-only release (myada_user_id, student/faculty) keeps its people and permits."""
    if os.environ.get("PARKING_TEST_DATABASE_URL"):
        pytest.skip("SQLite migration")
    import importlib
    import sqlite3

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE users (id INTEGER PRIMARY KEY, myada_user_id TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL,
            email TEXT NOT NULL, phone TEXT,
            affiliation TEXT NOT NULL CHECK (affiliation IN ('student','faculty','staff')),
            is_active INTEGER NOT NULL DEFAULT 1);
        INSERT INTO users VALUES (1, 'S1001', 'Leyla Mammadova', 'lmammadova@ada.edu.az', NULL, 'student', 1);
        INSERT INTO users VALUES (2, 'X9001', 'Someone Real', 'someone@example.org', NULL, 'faculty', 1);
        CREATE TABLE vehicles (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
            plate_display TEXT NOT NULL, plate_normalized TEXT NOT NULL, make TEXT NOT NULL, model TEXT NOT NULL,
            color TEXT NOT NULL, created_at TEXT NOT NULL);
        INSERT INTO vehicles VALUES (1, 1, '10-AB-123', '10AB123', 'Toyota', 'Corolla', 'White', '2026-01-01T00:00:00+00:00');
    """)
    old.commit()
    old.close()
    monkeypatch.setenv("PARKING_DB", str(path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    from app import db, main

    importlib.reload(db)
    importlib.reload(main)
    with TestClient(main.app) as client:
        tok = client.post("/api/v1/auth/mock-login", json={"account_id": "M1001"}).json()["token"]
        me = client.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"}).json()
    assert me["user"]["id"] == 1 and me["user"]["affiliation"] == "member"
    c = sqlite3.connect(path)
    assert c.execute("SELECT account_id, affiliation FROM users WHERE id=2").fetchone() == ("X9001", "member")
    assert c.execute("SELECT owner_id FROM vehicles").fetchone() == (1,)
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []
    c.close()
