from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


Source = Literal["jm"]


class ApiOk(BaseModel):
    st: int = 0
    msg: str = ""


class UserProfile(BaseModel):
    source: Source
    username: str | None = None
    nickname: str | None = None
    avatar_url: str | None = None
    signature: str | None = None
    raw: dict[str, Any] | None = None


class ComicSummary(BaseModel):
    source: Source
    comic_id: str
    title: str
    author: str | None = None
    cover_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    category: str | None = None
    raw: dict[str, Any] | None = None


class ChapterSummary(BaseModel):
    id: str
    title: str
    order: int | None = None


class ComicDetail(BaseModel):
    source: Source
    comic_id: str
    title: str
    author: str | None = None
    cover_url: str | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    category: str | None = None
    chapters: list[ChapterSummary] = Field(default_factory=list)
    raw: dict[str, Any] | None = None


class ChapterPage(BaseModel):
    name: str
    url: str | None = None


class ChapterDetail(BaseModel):
    source: Source
    chapter_id: str
    title: str | None = None
    images: list[ChapterPage] = Field(default_factory=list)
    raw: dict[str, Any] | None = None


class CommentItem(BaseModel):
    source: Source
    comment_id: str
    user: str | None = None
    avatar_url: str | None = None
    content: str | None = None
    parent_id: str | None = None
    likes: int | None = None
    created_at: str | None = None
    raw: dict[str, Any] | None = None


class DownloadTaskCreate(BaseModel):
    source: Source
    comic_id: str
    comic_title: str | None = None
    chapters: list[dict[str, str]] = Field(default_factory=list)
