from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

from backend.core.paths import app_data_dir


def _store_path() -> str:
    if os.environ.get("JM_AURA_SITE_PROFILE_PATH"):
        return os.environ["JM_AURA_SITE_PROFILE_PATH"]
    if getattr(sys, "frozen", False):
        return os.path.join(app_data_dir(), "site_profiles.json")
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_dir, "backend", "config", "site_profiles.json")


def _load_raw() -> dict[str, Any]:
    p = _store_path()
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


def _save_raw(data: dict[str, Any]) -> None:
    p = _store_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def get_profile(username: str) -> dict[str, Any]:
    u = str(username or "").strip()
    if not u:
        return {}
    raw = _load_raw()
    users = raw.get("users")
    if not isinstance(users, dict):
        return {}
    v = users.get(u)
    return v if isinstance(v, dict) else {}


def patch_profile(username: str, patch: dict[str, Any]) -> dict[str, Any]:
    u = str(username or "").strip()
    if not u:
        return {}
    raw = _load_raw()
    users = raw.get("users")
    if not isinstance(users, dict):
        users = {}
        raw["users"] = users
    cur = users.get(u)
    if not isinstance(cur, dict):
        cur = {}
        users[u] = cur

    if isinstance(patch.get("theme"), dict):
        t = patch.get("theme") or {}
        out: dict[str, Any] = {}
        if isinstance(t.get("dark"), bool):
            out["dark"] = bool(t.get("dark"))
        c = str(t.get("color") or "").strip().lower()
        if c in ("default", "orange", "green", "yuuka"):
            out["color"] = c
        cur["theme"] = {**(cur.get("theme") if isinstance(cur.get("theme"), dict) else {}), **out}

    if isinstance(patch.get("features"), dict):
        f = patch.get("features") or {}
        out2: dict[str, Any] = {}
        for k in ("savePassword", "autoLogin", "autoCheckin"):
            if isinstance(f.get(k), bool):
                out2[k] = bool(f.get(k))
        cur["features"] = {**(cur.get("features") if isinstance(cur.get("features"), dict) else {}), **out2}

    cur["updated_at"] = int(time.time())
    raw["v"] = 1
    _save_raw(raw)
    return cur

