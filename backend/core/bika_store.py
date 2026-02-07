from __future__ import annotations

import json
import os
from typing import Any

from backend.core.paths import app_data_dir


def _default_store_path() -> str:
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_dir, "backend", "config", "bika.json")


def get_store_path() -> str:
    if os.environ.get("JM_AURA_BIKA_STORE_PATH"):
        return os.environ["JM_AURA_BIKA_STORE_PATH"]
    if getattr(__import__("sys"), "frozen", False):
        return os.path.join(app_data_dir(), "bika.json")
    return _default_store_path()


def load_store() -> dict[str, Any]:
    p = get_store_path()
    if not os.path.exists(p):
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def save_store(data: dict[str, Any]) -> None:
    p = get_store_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def get_authorization() -> str | None:
    d = load_store()
    auth = d.get("authorization")
    return auth if isinstance(auth, str) and auth else None


def set_authorization(auth: str | None) -> None:
    d = load_store()
    if auth:
        d["authorization"] = auth
    else:
        d.pop("authorization", None)
    save_store(d)

