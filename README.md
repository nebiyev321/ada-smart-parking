# Smart Parking

A parking-permit, gate and visitor-pass service for any organisation's site: a campus, an office park, a residential complex. It runs as its own service beside the organisation's accounts. Sign-in is mocked: you pick a demo account instead of going through single sign-on.

## Run it

```bash
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --reload
# open http://localhost:8000
```

The SQLite database (`parking.db`) is created on first start and comes with six demo accounts. Delete the file to start over. Interactive API docs are at http://localhost:8000/docs.

Run the tests with `python3 -m pytest -q`. There are 39 tests, covering the rules below, the input and access checks, and the XSS defences (CSP, JSON-only data, verbatim storage, the client escape helper).

The browser half of the XSS check stores inert markup probes in every free-text field, renders each screen in headless Chrome and fails if a probe becomes an element or the page reports a CSP violation: `node tests/browser/xss_dom_check.mjs` (uses its own temporary database; set `CHROME_PATH` if Chrome is not at the default Windows path).

## Demo accounts

| Account | Role | What to try |
| --- | --- | --- |
| Leyla Mammadova, Murad Aliyev (`M1001`, `M1002`, members) | Vehicle owner | Register a car, watch it wait for approval, try a vehicle change, issue a visitor pass, renew |
| Nigar Huseynova (`C2001`, contractor) | Vehicle owner | The same as a member; groups are labels admins see |
| Rashad Karimov (`E3001`, staff) | Guard | Gate check (entry/exit), approve visitor passes, cars on site now, plate search and the vehicle list, gate log |
| Aysel Guliyeva (`E3002`, staff) | Parking admin | Approvals (including "Approve all renewals"), contact owner, suspend, allow an early change |
| Tural Hasanov (`E3003`, staff) | System admin and parking admin | Audit log; cooldown, renewal-window and permit-length settings |

A quick walkthrough: Leyla registers `10-AB-123`, Aysel approves it, Rashad records an entry, Aysel searches `10AB` and sends "Please move your vehicle", and Leyla sees the message, her entry history and the date she can next change vehicle.

## Rules implemented

- One active vehicle per person (database unique index) and one owner per plate. Plates are normalised, so `10-ab-123` and `10 AB 123` match.
- New registrations and vehicle changes both need admin approval. During a change, the old vehicle stays valid until the new one is approved.
- Vehicle change cooldown: 90 days by default, counted from when the current vehicle became active. The system admin can change it.
- An admin can allow one early change (car sold, accident) with a written reason. The override is used up by the next change request.
- Permit length is a setting: 365 days by default, or a fixed yearly end date (`MM-DD`, for example `06-30` for an academic year) that every permit runs to, at 23:59 site time. The system admin sets both under Audit and settings. An expiry job marks permits expired at startup and on demand.
- A suspended, expired or unknown plate is recorded at the gate as "no permit" and flagged for the guard to check. It is never blocked automatically.
- Guards see the owner's name and permit status. Only admins see email and phone.
- Visitor passes: any member can ask to let a guest's plate in for one day, today or up to 30 days ahead, at most 3 passes per day (admins have no limit). A guard or admin approves or rejects each request in Approvals (a pass they issue themselves is approved at once). Only approved passes count at the gate, which then shows "Allow, visitor of <host>"; for a pass still waiting, the gate verdict says so and offers "Approve pass". The host sees each pass's status and can cancel it.
- Find a vehicle lists every registered vehicle under the search, with its current permit status (no contact details; viewing the list is audited).
- On site now: a car is inside when its latest movement is an entry. Cars that entered before midnight (site time) are flagged as overnight, and plates with no permit stay listed until they leave. Today's expected visitors are listed with whether they have arrived.
- Renewal: an active permit can be renewed in the last 30 days of its term (the system admin can change the window). A renewal keeps the vehicle, continues from the current end date with no gap, and needs admin approval; admins can approve all waiting renewals at once.
- Repeat alerts: a plate that has entered without a permit or pass three or more times is flagged on the gate verdict and in plate search. It is still never blocked.
- Display: every screen has an EN/AZ language switch and a light/dark switch (in the header, and above the sign-in card). Without a saved choice the theme follows the device and the language follows the browser; choices are kept in this browser only. Azerbaijani covers the whole interface, server messages, dates and the messages site security sends from templates. A test fails if any interface string or server message lacks a translation.
- An owner with an active permit can print it (My vehicle, "Print permit"): the page prints the permit alone, in light colours, to place behind the windscreen.
- Manual gate checks are recorded at gate "main"; the gate ID is stored on every movement, so more gates or cameras need no schema change.
- The audit log records approvals, rejections, overrides, renewals, visitor passes, plate searches, owner contacts and setting changes.

## Layout

```
app/main.py         API routes and business rules
app/auth.py         mocked sign-in (HMAC token); replace with OIDC against your identity provider
app/db.py           schema and demo data (SQLite here, PostgreSQL in production)
app/static/         single-page UI for owners, guards and admins
tests/test_api.py   API tests
docs/screenshots/   screens from the browser walkthrough (from the earlier ADA-branded design)
```

## API

All routes are under `/api/v1`. User and staff calls need `Authorization: Bearer <token>`.

| Route | Who |
| --- | --- |
| `GET /me`, `POST /vehicles`, `POST /change-requests`, `GET /me/gate-events`, `GET /me/messages` | Vehicle owner |
| `GET /admin/vehicles?plate=`, `POST /admin/gate-events`, `GET /admin/gate-events` (`?format=csv`) | Guard and admins |
| `GET /admin/queue`, `POST /admin/permits/{id}/approve, reject, suspend, reinstate`, `POST /admin/users/{id}/cooldown-override`, `POST /admin/users/{id}/contact` | Parking admin |
| `GET /admin/on-site` | Guard and admins |
| `GET /admin/audit-log`, `GET`/`PUT /admin/settings`, `POST /admin/jobs/expire` | System admin |
| `POST /gate/reads` with `X-Gate-Key` header | Gate camera or RFID reader (phase 2 stub; reads with confidence below 0.8 go to the guard) |

## Not in the prototype yet

- Real single sign-on and directory sync. `app/auth.py` is the only file that has to change for this.
- Uploading the registration certificate with a new registration.
- Real email or in-app notifications. Messages are stored and shown on the owner's page.
- Camera or RFID hardware. The `/gate/reads` endpoint is ready for it.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. When unset, the app uses the SQLite file `parking.db` (or `PARKING_DB`). |
| `PARKING_SECRET`, `PARKING_GATE_KEY` | Token signing secret and gate device key. Development defaults exist locally; a deployment refuses to start without them. |
| `PARKING_DEMO_LOGIN` | `1` shows the pick-a-demo-account sign-in. On by default locally, off by default when deployed. Anyone who can open the site can sign in as any account, including admins, so turn it off once real sign-in is connected. |
| `PARKING_UTC_OFFSET` | The site's clock as a UTC offset, such as `+04:00` (the default) or `-05:00`. Day passes, overnight flags and fixed permit end dates follow it. |

Run the tests against PostgreSQL with `PARKING_TEST_DATABASE_URL=<url> python -m pytest -q`. The tests drop the app's tables, so use a throwaway database.

## Upgrading from the ADA-only release

Starting the app on an existing database migrates it in place: `users.myada_user_id` becomes `users.account_id`, students and faculty become members, staff stay staff, and the six demo accounts get their new IDs (`S1001` → `M1001`, `S1002` → `M1002`, `F2001` → `C2001`). Permits, vehicles and history carry over. To keep the old academic-year rule, set the fixed end date to `06-30` under Audit and settings.
