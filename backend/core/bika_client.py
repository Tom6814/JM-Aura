from __future__ import annotations

import os
from typing import Any, Literal

import requests

from backend.core.bika_auth import build_headers, clean_path
from backend.core.bika_store import get_authorization
from backend.core.http_bytes import decode_json_bytes
from backend.providers.base import NeedLoginError, ProviderError


Method = Literal["GET", "POST", "PUT", "DELETE"]


class BikaClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or os.environ.get("BIKA_BASE_URL") or "https://picaapi.picacomic.com/"
        self.session = requests.Session()

    def request(
        self,
        method: Method,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any | None = None,
        data: Any | None = None,
        headers: dict[str, Any] | None = None,
        require_auth: bool = False,
        timeout: int = 20,
    ) -> Any:
        p = clean_path(path, base_url=self.base_url)
        url = self.base_url.rstrip("/") + "/" + p
        auth = get_authorization()
        if require_auth and not auth:
            raise NeedLoginError()

        h = build_headers(p, method, authorization=auth)
        if headers:
            h.update(headers)

        resp = self.session.request(
            method,
            url,
            params=params,
            json=json_body,
            data=data,
            headers=h,
            timeout=timeout,
        )

        body = decode_json_bytes(resp.content or b"")
        if isinstance(body, dict):
            code = body.get("code")
            msg = body.get("message") or body.get("error") or body.get("errorMsg")
            if code == 401 or (isinstance(msg, str) and msg.lower() == "unauthorized"):
                raise NeedLoginError()
            if code not in (None, 200):
                raise ProviderError(str(msg or f"Bika API error: {code}"), status=400)
        if resp.status_code == 401:
            raise NeedLoginError()
        if resp.status_code >= 400:
            raise ProviderError(f"HTTP {resp.status_code}", status=resp.status_code)
        return body


bika_client = BikaClient()

