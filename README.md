# ADA Smart Parking: MVP prototype

A working prototype of the Parking service described in the proposal doc. It runs as its own service beside MyADA. Sign-in is mocked: you pick a demo ADA account instead of going through MyADA single sign-on.

## Run it

```bash
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --reload
# open http://localhost:8000
```

The SQLite database (`parking.db`) is created on first start and comes with six demo accounts. Delete the file to start over. Interactive API docs are at http://localhost:8000/docs.

Run the tests with `python3 -m pytest -q`. There are 18 tests, covering the rules below and the input and access checks.

## Demo accounts

| Account | Role | What to try |
| --- | --- | --- |
| Leyla Mammadova, Murad Aliyev (students) | Vehicle owner | Register a car, watch it wait for approval, try a vehicle change |
| Dr. Nigar Huseynova (faculty) | Vehicle owner | Permit runs one year instead of to the end of June |
| Rashad Karimov (staff) | Guard | Gate check (entry/exit), plate search, gate log |
| Aysel Guliyeva (staff) | Parking admin | Approvals, contact owner, suspend, allow an early change |
| Tural Hasanov (staff) | System admin and parking admin | Audit log, cooldown setting |

A quick walkthrough: Leyla registers `10-AB-123`, Aysel approves it, Rashad records an entry, Aysel searches `10AB` and sends "Please move your vehicle", and Leyla sees the message, her entry history and the date she can next change vehicle.

## Rules implemented

- One active vehicle per person (database unique index) and one owner per plate. Plates are normalised, so `10-ab-123` and `10 AB 123` match.
- New registrations and vehicle changes both need admin approval. During a change, the old vehicle stays valid until the new one is approved.
- Vehicle change cooldown: 90 days by default, counted from when the current vehicle became active. The system admin can change it.
- An admin can allow one early change (car sold, accident) with a written reason. The override is used up by the next change request.
- Permits run to 30 June for students and for one year for faculty and staff. An expiry job marks them expired at startup and on demand.
- A suspended, expired or unknown plate is recorded at the gate as "no permit" and flagged for the guard to check. It is never blocked automatically.
- Guards see the owner's name and permit status. Only admins see email and phone.
- The audit log records approvals, rejections, overrides, plate searches, owner contacts and setting changes.

## Layout

```
app/main.py         API routes and business rules
app/auth.py         mocked MyADA sign-in (HMAC token); replace with OIDC for ADA SSO
app/db.py           schema and demo data (SQLite here, PostgreSQL in production)
app/static/         single-page UI for owners, guards and admins
tests/test_api.py   API tests
docs/screenshots/   screens from the browser walkthrough
```

## API

All routes are under `/api/v1`. User and staff calls need `Authorization: Bearer <token>`.

| Route | Who |
| --- | --- |
| `GET /me`, `POST /vehicles`, `POST /change-requests`, `GET /me/gate-events`, `GET /me/messages` | Vehicle owner |
| `GET /admin/vehicles?plate=`, `POST /admin/gate-events`, `GET /admin/gate-events` (`?format=csv`) | Guard and admins |
| `GET /admin/queue`, `POST /admin/permits/{id}/approve, reject, suspend, reinstate`, `POST /admin/users/{id}/cooldown-override`, `POST /admin/users/{id}/contact` | Parking admin |
| `GET /admin/audit-log`, `PUT /admin/settings`, `POST /admin/jobs/expire` | System admin |
| `POST /gate/reads` with `X-Gate-Key` header | Gate camera or RFID reader (phase 2 stub; reads with confidence below 0.8 go to the guard) |

## Not in the prototype yet

- Real MyADA sign-in and directory sync. `app/auth.py` is the only file that has to change for this.
- Uploading the registration certificate with a new registration.
- Real email or MyADA notifications. Messages are stored and shown on the owner's page.
- Camera or RFID hardware. The `/gate/reads` endpoint is ready for it.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. When unset, the app uses the SQLite file `parking.db` (or `PARKING_DB`). |
| `PARKING_SECRET`, `PARKING_GATE_KEY` | Token signing secret and gate device key. Development defaults exist locally; a deployment refuses to start without them. |
| `PARKING_DEMO_LOGIN` | `1` shows the pick-a-demo-account sign-in. On by default locally, off by default when deployed. Anyone who can open the site can sign in as any account, including admins, so turn it off once MyADA sign-in is connected. |

Run the tests against PostgreSQL with `PARKING_TEST_DATABASE_URL=<url> python -m pytest -q`. The tests drop the app's tables, so use a throwaway database.
