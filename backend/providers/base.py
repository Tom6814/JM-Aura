from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from backend.models.schemas import ChapterDetail, ComicDetail, ComicSummary, UserProfile


class ProviderError(Exception):
    def __init__(self, message: str, status: int = 500):
        super().__init__(message)
        self.status = status


class NeedLoginError(ProviderError):
    def __init__(self, message: str = "Need login"):
        super().__init__(message, status=401)


class ComicProvider(ABC):
    source: str

    @abstractmethod
    def login(self, username: str, password: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def register(self, username: str, password: str, **kwargs: Any) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def profile(self) -> UserProfile:
        raise NotImplementedError

    @abstractmethod
    def check_in(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def search(self, q: str, page: int = 1, **kwargs: Any) -> list[ComicSummary]:
        raise NotImplementedError

    @abstractmethod
    def categories(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def leaderboard(self, **kwargs: Any) -> list[ComicSummary]:
        raise NotImplementedError

    @abstractmethod
    def random(self, **kwargs: Any) -> ComicSummary | None:
        raise NotImplementedError

    @abstractmethod
    def also_viewed(self, comic_id: str, **kwargs: Any) -> list[ComicSummary]:
        raise NotImplementedError

    @abstractmethod
    def comic_detail(self, comic_id: str) -> ComicDetail:
        raise NotImplementedError

    @abstractmethod
    def chapter_detail(self, chapter_id: str, **kwargs: Any) -> ChapterDetail:
        raise NotImplementedError

    @abstractmethod
    def comments(self, comic_id: str, page: int = 1, **kwargs: Any) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def send_comment(self, comic_id: str, content: str, reply_to: str | None = None, **kwargs: Any) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def like_comment(self, comment_id: str, **kwargs: Any) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def toggle_favorite(self, comic_id: str, **kwargs: Any) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def like_comic(self, comic_id: str, **kwargs: Any) -> dict[str, Any]:
        raise NotImplementedError

