import json
import os
import sys

import requests
from requests.utils import cookiejar_from_dict, dict_from_cookiejar

from backend.core.paths import app_data_dir
from backend.core.jm_context import current_jm_identity


_SESSIONS: dict[str, requests.Session] = {}

def _is_guest_identity(user: str | None) -> bool:
    u = str(user or "").strip()
    return u.startswith("g:")


def _safe_user_key(user: str) -> str:
    s = str(user or "").strip()
    if not s:
        return "anon"
    out = []
    for ch in s:
        if ch.isalnum() or ch in ("-", "_", ".", "@"):
            out.append(ch)
        else:
            out.append("_")
    return "".join(out)[:80] or "anon"


def _cookie_file_path(user: str) -> str:
    if os.environ.get("JM_AURA_COOKIE_PATH"):
        base = os.environ["JM_AURA_COOKIE_PATH"]
        return base
    key = _safe_user_key(user)
    if getattr(sys, "frozen", False):
        return os.path.join(app_data_dir(), "cookies", f"{key}.json")
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_dir, "config", "cookies", f"{key}.json")


def _get_user(user: str | None) -> str:
    if user:
        return str(user)
    u = current_jm_identity.get()
    return str(u or "anon")


def get_session(user: str | None = None) -> requests.Session:
    u = _get_user(user)
    key = _safe_user_key(u)
    if key in _SESSIONS:
        return _SESSIONS[key]
    s = requests.Session()
    adapter = requests.adapters.HTTPAdapter(pool_connections=50, pool_maxsize=50)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    _SESSIONS[key] = s
    load_cookies(u)
    return s


def load_cookies(user: str | None = None) -> None:
    u = _get_user(user)
    if _is_guest_identity(u):
        return
    p = _cookie_file_path(u)
    if not os.path.exists(p):
        return
    s = get_session(u)
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            s.cookies = cookiejar_from_dict(data)
    except Exception:
        return


def save_cookies(user: str | None = None) -> None:
    u = _get_user(user)
    if _is_guest_identity(u):
        return
    s = get_session(u)
    p = _cookie_file_path(u)
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        data = dict_from_cookiejar(s.cookies)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        return


def clear_cookies(user: str | None = None) -> None:
    u = _get_user(user)
    s = get_session(u)
    s.cookies.clear()
    p = _cookie_file_path(u)
    try:
        if os.path.exists(p):
            os.remove(p)
    except Exception:
        return


def migrate_legacy_cookies_to_user(user: str) -> bool:
    from backend.core.paths import default_cookie_path

    legacy = default_cookie_path()
    if not os.path.exists(legacy):
        return False
    u = str(user or "").strip()
    if not u:
        return False
    p = _cookie_file_path(u)
    if os.path.exists(p):
        return False
    try:
        with open(legacy, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return False
        s = get_session(u)
        s.cookies = cookiejar_from_dict(data)
        save_cookies(u)
        return True
    except Exception:
        return False
