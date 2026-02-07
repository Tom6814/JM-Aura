from __future__ import annotations

import hmac
import os
import time
import uuid
from hashlib import sha256
from typing import Any


def _api_key() -> str:
    return os.environ.get("BIKA_API_KEY") or "C69BAF41DA5ABD1FFEDC6D2FEA56B"


def _secret_key() -> str:
    return os.environ.get("BIKA_SECRET_KEY") or r"~d}$Q7$eIni=V)9\RK/P.RM4;9[7|@/CA}b~OW!3?EV`:<>M7pddUBL5n|0/*Cn"


def gen_nonce() -> str:
    return uuid.uuid4().hex


def gen_timestamp() -> int:
    return int(time.time())


def clean_path(url_or_path: str, base_url: str = "https://picaapi.picacomic.com/") -> str:
    p = (url_or_path or "").strip()
    if p.startswith(base_url):
        p = p[len(base_url) :]
    p = p.lstrip("/")
    return p


def sign(path: str, timestamp: int, nonce: str, method: str) -> str:
    raw = f"{path}{timestamp}{nonce}{method}{_api_key()}".lower().encode("utf-8")
    key = _secret_key().encode("utf-8")
    return hmac.new(key, raw, sha256).hexdigest()


def build_headers(path: str, method: str, authorization: str | None = None, image_quality: str = "original") -> dict[str, str]:
    nonce = gen_nonce()
    ts = gen_timestamp()
    sig = sign(path, ts, nonce, method)
    headers: dict[str, str] = {
        "api-key": _api_key(),
        "accept": "application/vnd.picacomic.com.v1+json",
        "app-channel": "3",
        "time": str(ts),
        "nonce": nonce,
        "signature": sig,
        "app-version": "2.2.1.3.3.4",
        "app-uuid": "defaultUuid",
        "app-platform": "android",
        "app-build-version": "45",
        "accept-encoding": "gzip",
        "user-agent": "okhttp/3.8.1",
        "content-type": "application/json; charset=UTF-8",
        "image-quality": image_quality,
    }
    if authorization:
        headers["authorization"] = str(authorization)
    return headers
