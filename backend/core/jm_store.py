from __future__ import annotations

import json
import os
from typing import Any

from backend.core.paths import app_data_dir
from backend.core.jm_context import current_jm_identity


def _default_store_path() -> str:
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_dir, "backend", "config", "jm.json")


def get_store_path() -> str:
    if os.environ.get("JM_AURA_JM_STORE_PATH"):
        return os.environ["JM_AURA_JM_STORE_PATH"]
    if getattr(__import__("sys"), "frozen", False):
        return os.path.join(app_data_dir(), "jm.json")
    return _default_store_path()


def load_store() -> dict[str, Any]:
    p = get_store_path()
    if not os.path.exists(p):
        return {"v": 1, "users": {}}
    try:
        with open(p, "r", encoding="utf-8") as f:
            v = json.load(f)
        if not isinstance(v, dict):
            return {"v": 1, "users": {}}
        if "users" not in v or not isinstance(v.get("users"), dict):
            v["users"] = {}
        return v
    except Exception:
        return {"v": 1, "users": {}}


def save_store(data: dict[str, Any]) -> None:
    p = get_store_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _user_key(user: str | None = None) -> str:
    u = str(user or "").strip()
    if not u:
        u = str(current_jm_identity.get() or "").strip()
    return u or "anon"


def _get_user_bucket(d: dict[str, Any], user: str | None = None) -> dict[str, Any]:
    users = d.get("users")
    if not isinstance(users, dict):
        users = {}
        d["users"] = users
    key = _user_key(user)
    b = users.get(key)
    if not isinstance(b, dict):
        b = {}
        users[key] = b
    return b


def set_user_id(user_id: str | None) -> None:
    d = load_store()
    b = _get_user_bucket(d)
    if user_id:
        b["user_id"] = user_id
    else:
        b.pop("user_id", None)
    save_store(d)


def get_user_id() -> str | None:
    d = load_store()
    b = _get_user_bucket(d)
    v = b.get("user_id")
    return v if isinstance(v, str) and v else None


def set_user_profile(raw: dict[str, Any]) -> None:
    d = load_store()
    b = _get_user_bucket(d)
    b["profile"] = raw
    save_store(d)


def get_user_profile() -> dict[str, Any] | None:
    d = load_store()
    b = _get_user_bucket(d)
    v = b.get("profile")
    return v if isinstance(v, dict) else None


def get_favorite_ids() -> set[str]:
    d = load_store()
    b = _get_user_bucket(d)
    v = b.get("favorite_ids")
    if isinstance(v, list):
        out: set[str] = set()
        for x in v:
            s = str(x or "").strip()
            if s:
                out.add(s)
        return out
    return set()


def is_favorite(album_id: str) -> bool:
    aid = str(album_id or "").strip()
    if not aid:
        return False
    return aid in get_favorite_ids()


def add_favorite_ids(album_ids: list[str]) -> None:
    d = load_store()
    b = _get_user_bucket(d)
    cur = get_favorite_ids()
    for x in album_ids:
        s = str(x or "").strip()
        if s:
            cur.add(s)
    b["favorite_ids"] = sorted(cur)
    save_store(d)


def set_favorite_ids(album_ids: list[str]) -> None:
    d = load_store()
    b = _get_user_bucket(d)
    out: set[str] = set()
    for x in album_ids:
        s = str(x or "").strip()
        if s:
            out.add(s)
    b["favorite_ids"] = sorted(out)
    save_store(d)


def set_favorite(album_id: str, present: bool) -> None:
    d = load_store()
    b = _get_user_bucket(d)
    cur = get_favorite_ids()
    aid = str(album_id or "").strip()
    if not aid:
        return
    if present:
        cur.add(aid)
    else:
        cur.discard(aid)
    b["favorite_ids"] = sorted(cur)
    save_store(d)


def clear_current_user_data(user: str | None = None) -> None:
    d = load_store()
    users = d.get("users")
    if not isinstance(users, dict):
        return
    key = _user_key(user)
    if key in users:
        users.pop(key, None)
        save_store(d)
