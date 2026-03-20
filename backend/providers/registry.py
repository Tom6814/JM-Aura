from __future__ import annotations

from typing import Literal, cast

from backend.providers.base import ComicProvider, ProviderError


Source = Literal["jm"]


_providers: dict[Source, ComicProvider] = {}


def register_provider(source: Source, provider: ComicProvider) -> None:
    _providers[source] = provider


def get_provider(source: str) -> ComicProvider:
    s = cast(Source, source)
    p = _providers.get(s)
    if not p:
        raise ProviderError(f"Not supported source: {source}", status=400)
    return p
