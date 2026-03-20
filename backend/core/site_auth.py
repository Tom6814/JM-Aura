from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from contextvars import ContextVar
from typing import Any

from fastapi import HTTPException, Request

from backend.core.paths import app_data_dir


current_site_user: ContextVar[str | None] = ContextVar("current_site_user", default=None)


def _user_store_path() -> str:
    if os.environ.get("JM_AURA_SITE_USERS_PATH"):
        return os.environ["JM_AURA_SITE_USERS_PATH"]
    if getattr(sys, "frozen", False):
        return os.path.join(app_data_dir(), "site_users.json")
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_dir, "backend", "config", "site_users.json")


def _load_users() -> dict[str, Any]:
    p = _user_store_path()
    if not os.path.exists(p):
        return {"v": 1, "users": {}}
    try:
        with open(p, "r", encoding="utf-8") as f:
            d = json.load(f)
        if not isinstance(d, dict):
            return {"v": 1, "users": {}}
        if "users" not in d or not isinstance(d.get("users"), dict):
            d["users"] = {}
        return d
    except Exception:
        return {"v": 1, "users": {}}


def _save_users(data: dict[str, Any]) -> None:
    p = _user_store_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _norm_username(u: str) -> str:
    s = str(u or "").strip()
    if not s:
        return ""
    if len(s) > 64:
        return ""
    for ch in s:
        if not (ch.isalnum() or ch in ("-", "_", ".", "@")):
            return ""
    return s


def has_any_user() -> bool:
    d = _load_users()
    return bool(d.get("users"))


def is_admin(username: str) -> bool:
    u = _norm_username(username)
    if not u:
        return False
    d = _load_users()
    info = (d.get("users") or {}).get(u)
    return bool(isinstance(info, dict) and info.get("is_admin") is True)


def _hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000, dklen=32)


def create_user(username: str, password: str, admin: bool = False) -> None:
    u = _norm_username(username)
    p = str(password or "")
    if not u or len(p) < 6:
        raise ValueError("Invalid username or password")
    d = _load_users()
    users = d.get("users") if isinstance(d.get("users"), dict) else {}
    if u in users:
        raise ValueError("User already exists")
    salt = secrets.token_bytes(16)
    h = _hash_password(p, salt)
    users[u] = {
        "salt_b64": base64.b64encode(salt).decode("ascii"),
        "hash_b64": base64.b64encode(h).decode("ascii"),
        "is_admin": bool(admin),
        "created_at": int(time.time()),
    }
    d["users"] = users
    _save_users(d)


def verify_user(username: str, password: str) -> bool:
    u = _norm_username(username)
    p = str(password or "")
    if not u or not p:
        return False
    d = _load_users()
    info = (d.get("users") or {}).get(u)
    if not isinstance(info, dict):
        return False
    try:
        salt = base64.b64decode(str(info.get("salt_b64") or ""), validate=True)
        hh = base64.b64decode(str(info.get("hash_b64") or ""), validate=True)
    except Exception:
        return False
    calc = _hash_password(p, salt)
    return hmac.compare_digest(calc, hh)


_GUEST_COOKIE = "jm_aura_gid"
_SESSION_COOKIE = "jm_aura_sid"
_sessions: dict[str, dict[str, Any]] = {}
_SESSION_TTL_SEC = 7 * 86400


def _session_store_path() -> str:
    if os.environ.get("JM_AURA_SITE_SESSIONS_PATH"):
        return os.environ["JM_AURA_SITE_SESSIONS_PATH"]
    if getattr(sys, "frozen", False):
        return os.path.join(app_data_dir(), "site_sessions.json")
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_dir, "backend", "config", "site_sessions.json")


def _load_sessions() -> dict[str, dict[str, Any]]:
    p = _session_store_path()
    if not os.path.exists(p):
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            d = json.load(f)
        if not isinstance(d, dict):
            return {}
        now = time.time()
        out: dict[str, dict[str, Any]] = {}
        for k, v in d.items():
            sid = str(k or "").strip()
            if not sid or len(sid) > 256:
                continue
            if not isinstance(v, dict):
                continue
            u = _norm_username(str(v.get("u") or ""))
            if not u:
                continue
            try:
                exp = float(v.get("exp") or 0.0)
            except Exception:
                exp = 0.0
            if exp and exp <= now:
                continue
            out[sid] = {"u": u, "exp": exp}
        return out
    except Exception:
        return {}


def _save_sessions(data: dict[str, dict[str, Any]]) -> None:
    p = _session_store_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


_sessions = _load_sessions()


def create_session(username: str) -> str:
    u = _norm_username(username)
    if not u:
        raise ValueError("Invalid username")
    sid = secrets.token_urlsafe(32)
    _sessions[sid] = {"u": u, "exp": time.time() + _SESSION_TTL_SEC}
    try:
        _save_sessions(_sessions)
    except Exception:
        pass
    return sid


def clear_session(sid: str) -> None:
    if sid:
        _sessions.pop(sid, None)
        try:
            _save_sessions(_sessions)
        except Exception:
            pass


def get_session_user(sid: str) -> str | None:
    if not sid:
        return None
    rec = _sessions.get(sid)
    if not isinstance(rec, dict):
        return None
    exp = float(rec.get("exp") or 0.0)
    if exp and time.time() > exp:
        _sessions.pop(sid, None)
        try:
            _save_sessions(_sessions)
        except Exception:
            pass
        return None
    u = str(rec.get("u") or "").strip()
    return _norm_username(u) or None


def get_current_user(request: Request) -> str | None:
    sid = request.cookies.get(_SESSION_COOKIE) or ""
    return get_session_user(str(sid))


def get_guest_id(request: Request) -> str | None:
    v = str(request.cookies.get(_GUEST_COOKIE) or "").strip()
    if not v:
        return None
    if len(v) > 128:
        return None
    for ch in v:
        if not (ch.isalnum() or ch in ("-", "_")):
            return None
    return v


def new_guest_id() -> str:
    return secrets.token_urlsafe(18).replace("-", "_")


def get_effective_user(request: Request) -> tuple[str, bool, str | None]:
    u = get_current_user(request)
    if u:
        return u, True, None
    gid = get_guest_id(request)
    if gid:
        return f"g:{gid}", False, None
    ng = new_guest_id()
    return f"g:{ng}", False, ng


def require_site_user(request: Request) -> str:
    u = get_current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return u


def site_auth_middleware_allow(path: str) -> bool:
    p = str(path or "")
    if not p.startswith("/api/"):
        return True
    if p.startswith("/api/site/"):
        return True
    if p.startswith("/api/client-info"):
        return True
    return False


def get_session_cookie_name() -> str:
    return _SESSION_COOKIE


def get_guest_cookie_name() -> str:
    return _GUEST_COOKIE
