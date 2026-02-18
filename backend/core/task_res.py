from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.core.status import Status


def ok(data: Any = None, msg: str = "") -> dict[str, Any]:
    return {"st": Status.Ok, "msg": msg, "data": data}


def err(st: int = Status.Error, msg: str = "", data: Any = None) -> dict[str, Any]:
    return {"st": st, "msg": msg, "data": data}


def merge_ok(payload: Any, msg: str = "") -> Any:
    if isinstance(payload, dict):
        out = dict(payload)
        out.setdefault("st", Status.Ok)
        out.setdefault("msg", msg)
        return out
    return ok(payload, msg=msg)

