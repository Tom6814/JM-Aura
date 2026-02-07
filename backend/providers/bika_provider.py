from __future__ import annotations

import base64
from typing import Any

from backend.core.bika_client import bika_client
from backend.core.bika_store import load_store, save_store, set_authorization
from backend.models.schemas import ChapterDetail, ChapterPage, ChapterSummary, ComicDetail, ComicSummary, UserProfile
from backend.providers.base import ComicProvider, NeedLoginError, ProviderError


class BikaProvider(ComicProvider):
    source = "bika"

    def login(self, username: str, password: str) -> dict[str, Any]:
        data = bika_client.request(
            "POST",
            "auth/sign-in",
            json_body={"email": username, "password": password},
            require_auth=False,
        )
        token = None
        if isinstance(data, dict):
            token = (data.get("data") or {}).get("token")
        if not token:
            raise ProviderError("Login failed", status=401)
        set_authorization(str(token))
        d = load_store()
        d["account"] = username
        d["password"] = password
        save_store(d)
        return {"token": token}

    def register(self, username: str, password: str, **kwargs: Any) -> dict[str, Any]:
        gender = kwargs.get("gender") or "m"
        birthday = kwargs.get("birthday") or "2000-01-01"
        name = kwargs.get("name") or (kwargs.get("nickname") or "user")
        body = {
            "answer1": "4",
            "answer2": "5",
            "answer3": "6",
            "birthday": birthday,
            "email": username,
            "gender": gender,
            "name": name,
            "password": password,
            "question1": "1",
            "question2": "2",
            "question3": "3",
        }
        data = bika_client.request("POST", "auth/register", json_body=body, require_auth=False)
        return data if isinstance(data, dict) else {"raw": data}

    def profile(self) -> UserProfile:
        data = bika_client.request("GET", "users/profile", require_auth=True)
        user = None
        if isinstance(data, dict):
            user = ((data.get("data") or {}).get("user") or {})
        if not isinstance(user, dict) or not user:
            raise NeedLoginError()
        return UserProfile(
            source="bika",
            username=str(user.get("email") or ""),
            nickname=user.get("name"),
            avatar_url=(user.get("avatar") or {}).get("fileServer") if isinstance(user.get("avatar"), dict) else None,
            signature=user.get("slogan"),
            raw=user,
        )

    def check_in(self) -> dict[str, Any]:
        data = bika_client.request("POST", "users/punch-in", require_auth=True)
        if isinstance(data, dict):
            res = ((data.get("data") or {}).get("res") or {})
            status = res.get("status") if isinstance(res, dict) else None
            if status == "ok":
                return {"status": "ok", "message": "签到成功"}
            if status == "fail":
                return {"status": "fail", "message": "已签到"}
        return {"status": "unknown", "raw": data}

    def update_profile(self, slogan: str) -> dict[str, Any]:
        return bika_client.request("PUT", "users/profile", json_body={"slogan": slogan}, require_auth=True)

    def update_password(self, old_password: str, new_password: str) -> dict[str, Any]:
        d = bika_client.request(
            "PUT",
            "users/password",
            json_body={"new_password": new_password, "old_password": old_password},
            require_auth=True,
        )
        store = load_store()
        store["password"] = new_password
        save_store(store)
        return d

    def update_avatar_base64(self, image_bytes: bytes, mime: str = "image/jpeg") -> dict[str, Any]:
        b64 = base64.b64encode(image_bytes).decode("ascii")
        return bika_client.request(
            "PUT",
            "users/avatar",
            json_body={"avatar": f"data:{mime};base64,{b64}"},
            require_auth=True,
        )

    def search(self, q: str, page: int = 1, **kwargs: Any) -> list[ComicSummary]:
        body: dict[str, Any] = {"keyword": q, "sort": kwargs.get("sort") or "dd"}
        category = kwargs.get("category")
        creator = kwargs.get("creator")
        tag = kwargs.get("tag")
        translation = kwargs.get("translation")
        if category:
            body["categories"] = [category] if isinstance(category, str) else category
        if creator:
            body["creatorId"] = creator
        if tag:
            body["tags"] = [tag] if isinstance(tag, str) else tag
        if translation:
            body["translationTeam"] = translation
        data = bika_client.request("POST", f"comics/advanced-search?page={page}", json_body=body, require_auth=True)
        comics = (((data or {}).get("data") or {}).get("comics") or {}).get("docs") if isinstance(data, dict) else None
        out: list[ComicSummary] = []
        if isinstance(comics, list):
            for c in comics:
                if not isinstance(c, dict):
                    continue
                cid = str(c.get("_id") or "")
                if not cid:
                    continue
                out.append(
                    ComicSummary(
                        source="bika",
                        comic_id=cid,
                        title=str(c.get("title") or ""),
                        author=c.get("author"),
                        cover_url=((c.get("thumb") or {}).get("fileServer") + "/" + (c.get("thumb") or {}).get("path"))
                        if isinstance(c.get("thumb"), dict)
                        else None,
                        tags=list(c.get("tags") or []),
                        category=(c.get("categories") or [None])[0] if isinstance(c.get("categories"), list) else None,
                        raw=c,
                    )
                )
        return out

    def categories(self) -> list[dict[str, Any]]:
        data = bika_client.request("GET", "categories", require_auth=True)
        cats = ((data.get("data") or {}).get("categories") or {}).get("docs") if isinstance(data, dict) else None
        if isinstance(cats, list):
            return cats
        return []

    def leaderboard(self, **kwargs: Any) -> list[ComicSummary]:
        days = kwargs.get("days") or "H24"
        data = bika_client.request("GET", f"comics/leaderboard?tt={days}&ct=VC", require_auth=True)
        docs = (((data.get("data") or {}).get("comics") or {}).get("docs")) if isinstance(data, dict) else None
        out: list[ComicSummary] = []
        if isinstance(docs, list):
            for c in docs:
                if not isinstance(c, dict):
                    continue
                cid = str(c.get("_id") or "")
                if not cid:
                    continue
                out.append(ComicSummary(source="bika", comic_id=cid, title=str(c.get("title") or ""), author=c.get("author"), raw=c))
        return out

    def random(self, **kwargs: Any) -> ComicSummary | None:
        data = bika_client.request("GET", "comics/random", require_auth=True)
        c = ((data.get("data") or {}).get("comics") or {}).get("docs") if isinstance(data, dict) else None
        if isinstance(c, list) and c:
            item = c[0]
            if isinstance(item, dict) and item.get("_id"):
                return ComicSummary(source="bika", comic_id=str(item["_id"]), title=str(item.get("title") or ""), author=item.get("author"), raw=item)
        return None

    def also_viewed(self, comic_id: str, **kwargs: Any) -> list[ComicSummary]:
        data = bika_client.request("GET", f"comics/{comic_id}/recommendation", require_auth=True)
        docs = (((data.get("data") or {}).get("comics") or {}).get("docs")) if isinstance(data, dict) else None
        out: list[ComicSummary] = []
        if isinstance(docs, list):
            for c in docs:
                if not isinstance(c, dict) or not c.get("_id"):
                    continue
                cover_url = None
                thumb = c.get("thumb")
                if isinstance(thumb, dict):
                    fs = thumb.get("fileServer")
                    path = thumb.get("path")
                    if fs and path:
                        cover_url = f"{fs}/{path}"
                out.append(
                    ComicSummary(
                        source="bika",
                        comic_id=str(c["_id"]),
                        title=str(c.get("title") or ""),
                        author=c.get("author"),
                        cover_url=cover_url,
                        tags=list(c.get("tags") or []),
                        category=(c.get("categories") or [None])[0] if isinstance(c.get("categories"), list) else None,
                        raw=c,
                    )
                )
        return out

    def comic_detail(self, comic_id: str) -> ComicDetail:
        data = bika_client.request("GET", f"comics/{comic_id}", require_auth=True)
        comic = ((data.get("data") or {}).get("comic")) if isinstance(data, dict) else None
        if not isinstance(comic, dict):
            raise ProviderError("Not found", status=404)
        cover = comic.get("thumb")
        cover_url = None
        if isinstance(cover, dict):
            fs = cover.get("fileServer")
            path = cover.get("path")
            if fs and path:
                cover_url = f"{fs}/{path}"

        chapters: list[ChapterSummary] = []
        page = 1
        while True:
            eps_data = bika_client.request("GET", f"comics/{comic_id}/eps?page={page}", require_auth=True)
            eps = ((eps_data.get("data") or {}).get("eps")) if isinstance(eps_data, dict) else None
            docs = (eps or {}).get("docs") if isinstance(eps, dict) else None
            pages_total = (eps or {}).get("pages") if isinstance(eps, dict) else None
            if isinstance(docs, list):
                for ep in docs:
                    if not isinstance(ep, dict):
                        continue
                    order = ep.get("order")
                    title = ep.get("title")
                    if order is None:
                        continue
                    chapters.append(ChapterSummary(id=str(order), title=str(title or f"EP {order}"), order=int(order)))
            if not isinstance(pages_total, int) or page >= pages_total:
                break
            page += 1
        return ComicDetail(
            source="bika",
            comic_id=str(comic.get("_id") or comic_id),
            title=str(comic.get("title") or ""),
            author=comic.get("author"),
            cover_url=cover_url,
            description=comic.get("description"),
            tags=list(comic.get("tags") or []),
            category=(comic.get("categories") or [None])[0] if isinstance(comic.get("categories"), list) else None,
            chapters=chapters,
            raw=comic,
        )

    def chapter_detail(self, chapter_id: str, **kwargs: Any) -> ChapterDetail:
        comic_id = kwargs.get("comic_id")
        ep_id = kwargs.get("ep_id")
        page = int(kwargs.get("page") or 1)
        if not comic_id or not ep_id:
            raise ProviderError("comic_id and ep_id required", status=400)
        data = bika_client.request("GET", f"comics/{comic_id}/order/{ep_id}/pages?page={page}", require_auth=True)
        pages = ((data.get("data") or {}).get("pages") or {}).get("docs") if isinstance(data, dict) else None
        imgs: list[ChapterPage] = []
        if isinstance(pages, list):
            for p in pages:
                if not isinstance(p, dict):
                    continue
                media = p.get("media")
                if isinstance(media, dict):
                    fs = media.get("fileServer")
                    path = media.get("path")
                    if fs and path:
                        imgs.append(ChapterPage(name=str(path), url=f"{fs}/{path}"))
        return ChapterDetail(source="bika", chapter_id=str(chapter_id), images=imgs, raw=data if isinstance(data, dict) else None)

    def comments(self, comic_id: str, page: int = 1, **kwargs: Any) -> dict[str, Any]:
        return bika_client.request("GET", f"comics/{comic_id}/comments?page={page}", require_auth=True)

    def send_comment(self, comic_id: str, content: str, reply_to: str | None = None, **kwargs: Any) -> dict[str, Any]:
        if reply_to:
            return bika_client.request("POST", f"comments/{reply_to}", json_body={"content": content}, require_auth=True)
        return bika_client.request("POST", f"comics/{comic_id}/comments", json_body={"content": content}, require_auth=True)

    def like_comment(self, comment_id: str, **kwargs: Any) -> dict[str, Any]:
        return bika_client.request("POST", f"comments/{comment_id}/like", require_auth=True)

    def toggle_favorite(self, comic_id: str, **kwargs: Any) -> dict[str, Any]:
        return bika_client.request("POST", f"comics/{comic_id}/favourite", require_auth=True)

    def like_comic(self, comic_id: str, **kwargs: Any) -> dict[str, Any]:
        return bika_client.request("POST", f"comics/{comic_id}/like", require_auth=True)
