from __future__ import annotations

import random
from typing import Any

from backend.core.config import GlobalConfig
from backend.core.http_session import save_cookies
from backend.core.jm_store import get_user_id, set_user_id, set_user_profile, get_user_profile
from backend.core.req import (
    AddAndDelFavoritesReq2,
    GetBookInfoReq2,
    GetCategoryReq2,
    GetCommentReq2,
    GetDailyReq2,
    GetIndexInfoReq2,
    GetLatestInfoReq2,
    GetSearchCategoryReq2,
    GetSearchReq2,
    LikeCommentReq2,
    LoginReq2,
    SendCommentReq2,
    SignDailyReq2,
)
from backend.core.api_adapter import adapt_album_detail, adapt_search_result
from backend.jm_service import jm_service
from backend.models.schemas import ChapterDetail, ChapterPage, ComicDetail, ComicSummary, UserProfile
from backend.providers.base import ComicProvider, ProviderError


class JmProvider(ComicProvider):
    source = "jm"

    def login(self, username: str, password: str) -> dict[str, Any]:
        data = LoginReq2(username, password).execute()
        save_cookies()
        jm_service.update_config(username, password)
        if isinstance(data, dict):
            set_user_profile(data)
            for k in ("uid", "user_id", "id"):
                v = data.get(k)
                if v:
                    set_user_id(str(v))
                    break
        return data if isinstance(data, dict) else {"raw": data}

    def register(self, username: str, password: str, **kwargs: Any) -> dict[str, Any]:
        raise ProviderError("JM register not supported in app API", status=400)

    def profile(self) -> UserProfile:
        cfg = jm_service.get_config()
        raw = get_user_profile()
        return UserProfile(
            source="jm",
            username=cfg.get("username") if isinstance(cfg, dict) else "",
            nickname=(raw or {}).get("username") if isinstance(raw, dict) else None,
            raw=raw,
        )

    def check_in(self) -> dict[str, Any]:
        uid = get_user_id()
        if not uid:
            raise ProviderError("Missing user_id, please login again", status=400)
        daily = GetDailyReq2(uid).execute()
        daily_id = None
        if isinstance(daily, dict):
            for key in ("daily_id", "id"):
                if daily.get(key):
                    daily_id = str(daily[key])
                    break
            if not daily_id:
                for key in ("list", "daily_list", "data"):
                    v = daily.get(key)
                    if isinstance(v, list) and v:
                        item = v[0]
                        if isinstance(item, dict):
                            daily_id = str(item.get("daily_id") or item.get("id") or "")
                            if daily_id:
                                break
        if not daily_id:
            raise ProviderError("Unable to get daily_id", status=400)
        res = SignDailyReq2(uid, daily_id).execute()
        return res if isinstance(res, dict) else {"raw": res}

    def search(self, q: str, page: int = 1, **kwargs: Any) -> list[ComicSummary]:
        raw = GetSearchReq2(q, page=page).execute()
        items = adapt_search_result(raw)
        out: list[ComicSummary] = []
        for it in items or []:
            if not isinstance(it, dict):
                continue
            aid = str(it.get("album_id") or "")
            if not aid:
                continue
            out.append(
                ComicSummary(
                    source="jm",
                    comic_id=aid,
                    title=str(it.get("title") or ""),
                    author=it.get("author"),
                    cover_url=it.get("image"),
                    category=it.get("category"),
                    raw=it,
                )
            )
        return out

    def categories(self) -> list[dict[str, Any]]:
        raw = GetCategoryReq2().execute()
        if isinstance(raw, dict):
            return raw.get("categories") or raw.get("data") or []
        return []

    def leaderboard(self, **kwargs: Any) -> list[ComicSummary]:
        category = kwargs.get("category") or "0"
        page = int(kwargs.get("page") or 1)
        sort = kwargs.get("sort") or "tf"
        tag = kwargs.get("tag")
        raw = GetSearchCategoryReq2(category=category, page=page, sort=sort, tag=tag).execute()
        items = adapt_search_result(raw)
        out: list[ComicSummary] = []
        for it in items or []:
            if isinstance(it, dict) and it.get("album_id"):
                out.append(ComicSummary(source="jm", comic_id=str(it["album_id"]), title=str(it.get("title") or ""), author=it.get("author"), cover_url=it.get("image"), raw=it))
        return out

    def random(self, **kwargs: Any) -> ComicSummary | None:
        base = GlobalConfig.GetImgUrl()
        def cover_url(aid: str) -> str:
            return f"{base}/media/albums/{aid}.jpg" if isinstance(base, str) and base else ""

        raw = GetLatestInfoReq2("0").execute()
        if isinstance(raw, list) and raw:
            it = random.choice(raw)
            if isinstance(it, dict) and it.get("id"):
                aid = str(it.get("id") or "").strip()
                title = str(it.get("name") or "")
                author = str(it.get("author") or "")
                img = str(it.get("image") or "").strip() or cover_url(aid)
                if aid:
                    return ComicSummary(source="jm", comic_id=aid, title=title, author=author, cover_url=img, raw=it)
            return None

        items = adapt_search_result(raw)
        if not items:
            return None
        it2 = random.choice(items)
        if isinstance(it2, dict) and it2.get("album_id"):
            aid2 = str(it2.get("album_id") or "").strip()
            return ComicSummary(source="jm", comic_id=aid2, title=str(it2.get("title") or ""), author=it2.get("author"), cover_url=str(it2.get("image") or "").strip() or cover_url(aid2), raw=it2)
        return None

    def also_viewed(self, comic_id: str, **kwargs: Any) -> list[ComicSummary]:
        def cover_url(aid: str) -> str:
            base = GlobalConfig.GetImgUrl()
            return f"{base}/media/albums/{aid}.jpg" if isinstance(base, str) and base else ""

        raw = GetIndexInfoReq2("0").execute()
        out: list[ComicSummary] = []
        seen: set[str] = set()
        cur = str(comic_id or "").strip()

        if isinstance(raw, list):
            for sec in raw:
                if not isinstance(sec, dict):
                    continue
                content = sec.get("content") or []
                if not isinstance(content, list):
                    continue
                for it in content:
                    if not isinstance(it, dict):
                        continue
                    aid = str(it.get("id") or "").strip()
                    if not aid or aid == cur or aid in seen:
                        continue
                    seen.add(aid)
                    title = str(it.get("name") or "")
                    author = str(it.get("author") or "")
                    img = str(it.get("image") or "").strip() or cover_url(aid)
                    out.append(ComicSummary(source="jm", comic_id=aid, title=title, author=author, cover_url=img, raw=it))
                    if len(out) >= 24:
                        return out

        if not out:
            raw2 = GetLatestInfoReq2("0").execute()
            if isinstance(raw2, list):
                for it in raw2:
                    if not isinstance(it, dict):
                        continue
                    aid = str(it.get("id") or "").strip()
                    if not aid or aid == cur or aid in seen:
                        continue
                    seen.add(aid)
                    title = str(it.get("name") or "")
                    author = str(it.get("author") or "")
                    img = str(it.get("image") or "").strip() or cover_url(aid)
                    out.append(ComicSummary(source="jm", comic_id=aid, title=title, author=author, cover_url=img, raw=it))
                    if len(out) >= 24:
                        break
            else:
                items = adapt_search_result(raw2)
                for it in items or []:
                    if not isinstance(it, dict):
                        continue
                    aid = str(it.get("album_id") or "").strip()
                    if not aid or aid == cur or aid in seen:
                        continue
                    seen.add(aid)
                    out.append(
                        ComicSummary(
                            source="jm",
                            comic_id=aid,
                            title=str(it.get("title") or ""),
                            author=str(it.get("author") or ""),
                            cover_url=str(it.get("image") or "").strip() or cover_url(aid),
                            raw=it,
                        )
                    )
                    if len(out) >= 24:
                        break

        return out

    def comic_detail(self, comic_id: str) -> ComicDetail:
        raw = GetBookInfoReq2(comic_id).execute()
        d = adapt_album_detail(raw) or {}
        eps = d.get("episode_list") or []
        chapters = []
        for idx, ep in enumerate(eps):
            if isinstance(ep, dict) and ep.get("id"):
                chapters.append({"id": str(ep["id"]), "title": str(ep.get("title") or ""), "order": idx})
        return ComicDetail(
            source="jm",
            comic_id=str(d.get("album_id") or comic_id),
            title=str(d.get("title") or ""),
            author=d.get("author"),
            cover_url=d.get("image"),
            description=d.get("description"),
            tags=list(d.get("tags") or []),
            category=d.get("category"),
            chapters=chapters,
            raw=d,
        )

    def chapter_detail(self, chapter_id: str, **kwargs: Any) -> ChapterDetail:
        data = jm_service.get_chapter_detail(chapter_id)
        imgs = []
        for x in (data.get("images") or []):
            s = str(x or "")
            if s:
                imgs.append(ChapterPage(name=s))
        return ChapterDetail(source="jm", chapter_id=str(chapter_id), title=data.get("title"), images=imgs, raw=data)

    def comments(self, comic_id: str, page: int = 1, **kwargs: Any) -> dict[str, Any]:
        return GetCommentReq2(comic_id, page=page).execute()

    def send_comment(self, comic_id: str, content: str, reply_to: str | None = None, **kwargs: Any) -> dict[str, Any]:
        return SendCommentReq2(comic_id, content, comment_id=reply_to or "").execute()

    def like_comment(self, comment_id: str, **kwargs: Any) -> dict[str, Any]:
        return LikeCommentReq2(comment_id).execute()

    def toggle_favorite(self, comic_id: str, **kwargs: Any) -> dict[str, Any]:
        return AddAndDelFavoritesReq2(comic_id).execute()

    def like_comic(self, comic_id: str, **kwargs: Any) -> dict[str, Any]:
        raise ProviderError("JM comic like not supported in current API", status=400)
