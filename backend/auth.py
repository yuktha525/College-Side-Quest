"""Password hashing and stateless HMAC session tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time


def hash_password(password: str) -> str:
    """Hash a password with a per-user random salt using PBKDF2-HMAC-SHA256."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return f"{base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    """Verify a plaintext password against a stored salt$digest string."""
    try:
        salt_b64, digest_b64 = stored.split("$", 1)
        salt = base64.urlsafe_b64decode(salt_b64.encode())
        expected = base64.urlsafe_b64decode(digest_b64.encode())
    except Exception:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return hmac.compare_digest(actual, expected)


def create_token(user_id: int, secret: str, ttl_seconds: int = 7 * 24 * 3600) -> str:
    """Create a signed URL-safe token containing user_id and expiration."""
    payload = {"uid": user_id, "exp": int(time.time()) + ttl_seconds}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    body = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    sig = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def verify_token(token: str, secret: str) -> int | None:
    """Return user_id if token signature is valid and unexpired, else None."""
    if not token or "." not in token:
        return None
    try:
        body, sig = token.split(".", 1)
        expected_sig = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        padded = body + "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return int(payload["uid"])
    except Exception:
        return None


def get_session_secret(conn) -> str:
    env_secret = os.environ.get("CSQ_SECRET")
    if env_secret:
        return env_secret
    row = conn.execute("SELECT value FROM meta WHERE key = 'session_secret'").fetchone()
    if row:
        return str(row["value"])
    fallback = secrets.token_hex(32)
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('session_secret', ?)", (fallback,))
    conn.commit()
    return fallback
