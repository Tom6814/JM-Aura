from __future__ import annotations

import gzip
import json
from typing import Any


def maybe_gunzip(data: bytes) -> bytes:
    if not data:
        return b""
    if len(data) >= 2 and data[0] == 0x1F and data[1] == 0x8B:
        try:
            return gzip.decompress(data)
        except Exception:
            return data
    return data


def decode_json_bytes(data: bytes) -> Any:
    raw = maybe_gunzip(data)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        try:
            return json.loads(raw.decode("utf-8", errors="ignore"))
        except Exception:
            return raw.decode("utf-8", errors="ignore")

