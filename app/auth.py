"""Mocked sign-in.

The prototype issues its own HMAC-signed token after the user picks a demo account.
In production this module is replaced by OpenID Connect validation against the organisation's
identity provider (or a signed JWT it hands over); the rest of the service only uses `current_user`.
"""
import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, Header, HTTPException, Request

# Deployed (Vercel sets VERCEL=1): refuse to start with the public development secrets.
DEPLOYED = bool(os.environ.get("VERCEL"))
if DEPLOYED and not (os.environ.get("PARKING_SECRET") and os.environ.get("PARKING_GATE_KEY")):
    raise RuntimeError("PARKING_SECRET and PARKING_GATE_KEY must be set in a deployed environment")

SECRET = os.environ.get("PARKING_SECRET", "dev-only-secret-change-me").encode()
GATE_API_KEY = os.environ.get("PARKING_GATE_KEY", "dev-gate-key").encode()
TOKEN_TTL = 8 * 3600
# The pick-an-account sign-in. On by default locally; a deployment must opt in with PARKING_DEMO_LOGIN=1.
DEMO_LOGIN = os.environ.get("PARKING_DEMO_LOGIN", "0" if DEPLOYED else "1") == "1"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def issue_token(account_id: str) -> str:
    payload = _b64(json.dumps({"sub": account_id, "exp": int(time.time()) + TOKEN_TTL}).encode())
    sig = _b64(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def verify_token(token: str) -> str:
    try:
        payload, sig = token.split(".")
    except ValueError:
        raise HTTPException(401, "Malformed token")
    expected = _b64(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig.encode(), expected.encode()):
        raise HTTPException(401, "Bad token signature")
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        sub, exp = str(data["sub"]), float(data["exp"])
    except (ValueError, KeyError, TypeError):
        raise HTTPException(401, "Malformed token")
    if exp < time.time():
        raise HTTPException(401, "Token expired")
    return sub


def current_user(request: Request, authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in first")
    account_id = verify_token(authorization[7:])
    conn = request.app.state.conn
    user = conn.execute("SELECT * FROM users WHERE account_id=?", (account_id,)).fetchone()
    if not user or not user["is_active"]:
        raise HTTPException(403, "This account is not active")
    roles = {r["role"] for r in conn.execute("SELECT role FROM staff_roles WHERE user_id=?", (user["id"],))}
    return {**dict(user), "roles": roles}


def require(*allowed):
    """Dependency that allows any of the given staff roles."""

    def check(user=Depends(current_user)):
        if not user["roles"] & set(allowed):
            raise HTTPException(403, "Your role cannot do this")
        return user

    return check


def gate_device(x_gate_key: str = Header(default="")):
    if not hmac.compare_digest(x_gate_key.encode(), GATE_API_KEY):
        raise HTTPException(401, "Unknown gate device")
