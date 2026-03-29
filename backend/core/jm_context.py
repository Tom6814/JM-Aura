from __future__ import annotations

from contextvars import ContextVar


current_jm_identity: ContextVar[str | None] = ContextVar("current_jm_identity", default=None)

