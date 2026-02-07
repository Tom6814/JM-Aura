from __future__ import annotations

import os
import re
import shutil
import threading
import time
from queue import Queue
from typing import Any
from urllib.parse import urlparse

from fastapi import BackgroundTasks, FastAPI, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.core.api_adapter import adapt_album_detail, adapt_chapter_detail, adapt_favorites, adapt_search_result
from backend.core.config import GlobalConfig
from backend.core.http_session import clear_cookies, get_session, save_cookies
from backend.core.jm_store import add_favorite_ids, is_favorite, set_favorite, set_user_id, set_user_profile
from backend.core.parsers import parse_chapter_view_template
from backend.core.status import Status
from backend.core.task_res import merge_ok, ok, err
from backend.core.req import (
    AddAndDelFavoritesReq2,
    AddFavoritesFoldReq2,
    DelFavoritesFoldReq2,
    RenameFavoritesFoldReq2,
    get_current_api_base,
    get_current_img_base,
    get_last_ok_api_base,
    GetBookEpsInfoReq2,
    GetBookEpsScrambleReq2,
    GetBookInfoReq2,
    GetCommentReq2,
    GetFavoritesReq2,
    GetHistoryReq2,
    GetIndexInfoReq2,
    GetLatestInfoReq2,
    MoveFavoritesFoldReq2,
    SendCommentReq2,
    LikeCommentReq2,
    GetSearchReq2,
    LoginReq2,
)
from backend.jm_service import jm_service
from backend.download_task_manager import DownloadTaskManager
from backend.providers.base import NeedLoginError, ProviderError
from backend.providers.jm_provider import JmProvider
from backend.providers.registry import get_provider, register_provider


app = FastAPI(title="JM-Dashboard")

register_provider("jm", JmProvider())


@app.get("/api/client-info")
def client_info(request: Request):
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    ip = xff or (request.client.host if request.client else "")
    return ok({"ip": ip}, msg="")


@app.get("/api/jm/debug")
def jm_debug():
    return ok(
        {
            "api_base": get_current_api_base(),
            "img_base": get_current_img_base(),
            "last_ok_api_base": get_last_ok_api_base(),
        },
        msg="",
    )


class ConfigRequest(BaseModel):
    username: str
    password: str


class V2AuthRequest(BaseModel):
    username: str
    password: str


class V2RegisterRequest(BaseModel):
    username: str
    password: str
    name: str | None = None
    gender: str | None = None
    birthday: str | None = None


class V2UpdateProfileRequest(BaseModel):
    signature: str


class V2UpdatePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class V2SendCommentRequest(BaseModel):
    content: str
    reply_to: str | None = None


class V2DownloadTaskRequest(BaseModel):
    comic_id: str
    comic_title: str | None = None
    chapters: list[dict[str, str]] | None = None
    include_all: bool = False


class DownloadRequest(BaseModel):
    album_id: str
    chapter_ids: list[str] = []

class DownloadChapter(BaseModel):
    id: str
    title: str = ""


class DownloadTaskCreateRequest(BaseModel):
    album_id: str
    album_title: str = ""
    chapters: list[DownloadChapter] = []


class FavoriteToggleRequest(BaseModel):
    album_id: str
    desired_state: bool | None = None


class FavoriteFolderRequest(BaseModel):
    type: str
    folder_name: str | None = None
    folder_id: str | None = None
    album_id: str | None = None


class CommentSendRequest(BaseModel):
    album_id: str
    comment: str
    comment_id: str | None = None


class CommentLikeRequest(BaseModel):
    cid: str


class DownloadManager:
    def __init__(self, max_concurrent: int = 3):
        self.max_concurrent = max_concurrent
        self.queue: Queue[tuple[str, list[str] | None]] = Queue()
        self._sema = threading.Semaphore(max_concurrent)
        self._worker_thread = threading.Thread(target=self._worker, daemon=True)
        self._worker_thread.start()

    def add_task(self, album_id: str, chapter_ids: list[str] | None = None) -> None:
        self.queue.put((album_id, chapter_ids))

    def _worker(self) -> None:
        while True:
            album_id, chapter_ids = self.queue.get()
            self._sema.acquire()
            try:
                jm_service.download_album(album_id, chapter_ids)
            finally:
                self._sema.release()
                self.queue.task_done()


download_manager = DownloadManager(max_concurrent=3)
download_task_manager = DownloadTaskManager(base_dir=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "downloads", "tasks"))


@app.post("/api/config")
async def update_config(config: ConfigRequest):
    try:
        data = LoginReq2(config.username, config.password).execute()
    except Exception:
        raise HTTPException(status_code=401, detail="Login failed. Please check your username and password.")

    save_cookies()

    if not jm_service.update_config(config.username, config.password):
        raise HTTPException(status_code=500, detail="Failed to save configuration")

    if isinstance(data, dict):
        set_user_profile(data)
        uid = None
        for k in ("uid", "user_id", "id"):
            v = data.get(k)
            if v:
                uid = str(v)
                break
        if not uid:
            for k in ("user", "userinfo", "profile", "member"):
                sub = data.get(k)
                if isinstance(sub, dict):
                    for kk in ("uid", "user_id", "id"):
                        vv = sub.get(kk)
                        if vv:
                            uid = str(vv)
                            break
                if uid:
                    break
        if uid:
            set_user_id(uid)

    return {"status": "success", "message": "Login successful and configuration updated", "st": Status.Ok, "msg": ""}


@app.post("/api/session/relogin")
async def session_relogin(req: V2AuthRequest):
    u = (req.username or "").strip()
    p = (req.password or "").strip()
    if not u or not p:
        return err(Status.UserError, "Missing username or password")
    try:
        data = LoginReq2(u, p).execute()
        save_cookies()

        if isinstance(data, dict):
            set_user_profile(data)
            uid = None
            for k in ("uid", "user_id", "id"):
                v = data.get(k)
                if v:
                    uid = str(v)
                    break
            if not uid:
                for k in ("user", "userinfo", "profile", "member"):
                    sub = data.get(k)
                    if isinstance(sub, dict):
                        for kk in ("uid", "user_id", "id"):
                            vv = sub.get(kk)
                            if vv:
                                uid = str(vv)
                                break
                    if uid:
                        break
            if uid:
                set_user_id(uid)

        return ok({"status": "success"}, msg="")
    except Exception:
        return err(Status.NotLogin, "Relogin failed")


@app.get("/api/config")
async def get_config():
    data = jm_service.get_config()
    if isinstance(data, dict):
        data.setdefault("st", Status.Ok)
        data.setdefault("msg", "")
    return data


@app.post("/api/logout")
async def logout():
    clear_cookies()
    set_user_id(None)
    set_user_profile({})
    if jm_service.update_config("", ""):
        return {"status": "success", "message": "Logged out", "st": Status.Ok, "msg": ""}
    raise HTTPException(status_code=500, detail="Logout failed")


def _v2_ok(data: Any) -> dict[str, Any]:
    return ok(data, msg="")


def _v2_err(e: Exception) -> dict[str, Any]:
    if isinstance(e, NeedLoginError):
        return err(Status.UserError, str(e))
    if isinstance(e, ProviderError):
        if e.status == 401:
            return err(Status.UserError, str(e))
        return err(Status.Error, str(e))
    return err(Status.Error, str(e))


@app.post("/api/v2/{source}/auth/login")
def v2_login(source: str, req: V2AuthRequest):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.login(req.username, req.password))
    except Exception as e:
        return _v2_err(e)


@app.post("/api/v2/{source}/auth/register")
def v2_register(source: str, req: V2RegisterRequest):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.register(req.username, req.password, name=req.name, gender=req.gender, birthday=req.birthday))
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/user/profile")
def v2_profile(source: str):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.profile().model_dump())
    except Exception as e:
        return _v2_err(e)


@app.post("/api/v2/{source}/user/checkin")
def v2_checkin(source: str):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.check_in())
    except Exception as e:
        return _v2_err(e)


@app.put("/api/v2/{source}/user/profile")
def v2_update_profile(source: str, req: V2UpdateProfileRequest):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        fn = getattr(p, "update_profile", None)
        if not callable(fn):
            raise ProviderError("Not supported", status=400)
        return _v2_ok(fn(req.signature))
    except Exception as e:
        return _v2_err(e)


@app.put("/api/v2/{source}/user/password")
def v2_update_password(source: str, req: V2UpdatePasswordRequest):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        fn = getattr(p, "update_password", None)
        if not callable(fn):
            raise ProviderError("Not supported", status=400)
        return _v2_ok(fn(req.old_password, req.new_password))
    except Exception as e:
        return _v2_err(e)


@app.put("/api/v2/{source}/user/avatar")
def v2_update_avatar(source: str, file: UploadFile = File(...)):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        fn = getattr(p, "update_avatar_base64", None)
        if not callable(fn):
            raise ProviderError("Not supported", status=400)
        content = file.file.read()
        mime = file.content_type or "image/jpeg"
        return _v2_ok(fn(content, mime=mime))
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/categories")
def v2_categories(source: str):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.categories())
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/search")
def v2_search(
    source: str,
    q: str,
    page: int = 1,
    mode: str | None = None,
    category: str | None = None,
    tag: str | None = None,
    creator: str | None = None,
    translation: str | None = None,
    sort: str | None = None,
):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        items = p.search(
            q,
            page=page,
            mode=mode,
            category=category,
            tag=tag,
            creator=creator,
            translation=translation,
            sort=sort,
        )
        return _v2_ok([x.model_dump() for x in items])
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/leaderboard")
def v2_leaderboard(source: str, days: str | None = None, category: str | None = None, page: int = 1, sort: str | None = None, tag: str | None = None):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        items = p.leaderboard(days=days, category=category, page=page, sort=sort, tag=tag)
        return _v2_ok([x.model_dump() for x in items])
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/random")
def v2_random(source: str):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        item = p.random()
        return _v2_ok(item.model_dump() if item else None)
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/also_viewed/{comic_id}")
def v2_also_viewed(source: str, comic_id: str):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        items = p.also_viewed(comic_id)
        return _v2_ok([x.model_dump() for x in items])
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/comic/{comic_id}")
def v2_comic_detail(source: str, comic_id: str):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        d = p.comic_detail(comic_id)
        return _v2_ok(d.model_dump())
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/chapter/{chapter_id}")
def v2_chapter_detail(source: str, chapter_id: str, comic_id: str | None = None, ep_id: str | None = None, page: int = 1):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        d = p.chapter_detail(chapter_id, comic_id=comic_id, ep_id=ep_id, page=page)
        return _v2_ok(d.model_dump())
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/comic/{comic_id}/comments")
def v2_comments(source: str, comic_id: str, page: int = 1):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.comments(comic_id, page=page))
    except Exception as e:
        return _v2_err(e)


@app.post("/api/v2/{source}/comic/{comic_id}/comments")
def v2_send_comment(source: str, comic_id: str, req: V2SendCommentRequest):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.send_comment(comic_id, req.content, reply_to=req.reply_to))
    except Exception as e:
        return _v2_err(e)


@app.post("/api/v2/{source}/comment/{comment_id}/like")
def v2_like_comment(source: str, comment_id: str):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.like_comment(comment_id))
    except Exception as e:
        return _v2_err(e)


@app.post("/api/v2/{source}/comic/{comic_id}/favorite")
def v2_toggle_favorite(source: str, comic_id: str):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.toggle_favorite(comic_id))
    except Exception as e:
        return _v2_err(e)


@app.post("/api/v2/{source}/comic/{comic_id}/like")
def v2_like_comic(source: str, comic_id: str):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.like_comic(comic_id))
    except Exception as e:
        return _v2_err(e)


@app.post("/api/v2/{source}/download/tasks")
def v2_create_download_task(source: str, req: V2DownloadTaskRequest):
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        chapters = req.chapters or []
        if req.include_all or not chapters:
            d = p.comic_detail(req.comic_id)
            chapters = []
            for c in d.chapters:
                if isinstance(c, dict):
                    cid = c.get("id")
                    title = c.get("title")
                else:
                    cid = getattr(c, "id", None)
                    title = getattr(c, "title", None)
                if cid:
                    chapters.append({"id": str(cid), "title": str(title or cid)})
        title = req.comic_title or ""
        if not title:
            try:
                title = p.comic_detail(req.comic_id).title
            except Exception:
                title = req.comic_id
        if source == "jm":
            task = download_task_manager.create_task(req.comic_id, title, chapters)
            pub = task.to_public()
            pub["download_url"] = f"/api/v2/{source}/download/tasks/{task.task_id}/download" if task.status == "completed" and task.zip_path else ""
            return _v2_ok(pub)
        raise ProviderError("Unknown source", status=400)
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/download/tasks/{task_id}")
def v2_get_download_task(source: str, task_id: str):
    try:
        if source == "jm":
            task = download_task_manager.get_task(task_id)
            if not task:
                raise ProviderError("Task not found", status=404)
            pub = task.to_public()
            if task.status == "completed" and task.zip_path:
                pub["download_url"] = f"/api/v2/{source}/download/tasks/{task.task_id}/download"
            return _v2_ok(pub)
        raise ProviderError("Unknown source", status=400)
    except Exception as e:
        return _v2_err(e)


@app.get("/api/v2/{source}/download/tasks/{task_id}/download")
def v2_download_task_zip(source: str, task_id: str):
    if source == "jm":
        task = download_task_manager.get_task(task_id)
        if not task or task.status != "completed" or not task.zip_path:
            raise HTTPException(status_code=404, detail="Zip not available")
        return FileResponse(task.zip_path, filename=os.path.basename(task.zip_path))
    raise HTTPException(status_code=400, detail="Unknown source")


@app.post("/api/v2/cache/cleanup")
def v2_cache_cleanup(keep_days: int = 7):
    bases = [
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "downloads", "tasks"),
    ]
    now = time.time()
    removed_dirs = 0
    removed_work = 0
    for base in bases:
        if not os.path.isdir(base):
            continue
        for name in os.listdir(base):
            p = os.path.join(base, name)
            if not os.path.isdir(p):
                continue
            try:
                mtime = os.path.getmtime(p)
            except Exception:
                mtime = now
            work = os.path.join(p, "work")
            if os.path.isdir(work):
                shutil.rmtree(work, ignore_errors=True)
                removed_work += 1
            if now - mtime > max(0, keep_days) * 86400:
                zips = os.path.join(p, "zips")
                if os.path.isdir(zips) and os.listdir(zips):
                    continue
                shutil.rmtree(p, ignore_errors=True)
                removed_dirs += 1
    return ok({"removed_dirs": removed_dirs, "removed_work": removed_work}, msg="")


@app.get("/api/promote")
def get_promote(page: str = "0"):
    try:
        return GetIndexInfoReq2(page).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/latest")
def get_latest(page: str = "0"):
    try:
        return GetLatestInfoReq2(page).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/search")
def search(q: str, page: int = 1):
    try:
        q2 = (q or "").strip()
        q_low = q2.lower().strip()
        m = re.fullmatch(r"(?:jm\s*)?(\d{3,})", q_low)
        if m and page == 1:
            album_id = m.group(1)
            try:
                raw_album = GetBookInfoReq2(album_id).execute()
                album = adapt_album_detail(raw_album)
                if album:
                    return {
                        "results": [
                            {
                                "album_id": album.get("album_id"),
                                "title": album.get("title"),
                                "author": album.get("author"),
                                "category": "",
                                "image": album.get("image"),
                            }
                        ],
                        "st": Status.Ok,
                        "msg": "",
                    }
            except Exception:
                pass
        raw = GetSearchReq2(q, page=page).execute()
        return {"results": adapt_search_result(raw), "st": Status.Ok, "msg": ""}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/album/{album_id}")
def get_album(album_id: str):
    try:
        raw = GetBookInfoReq2(album_id).execute()
        data = adapt_album_detail(raw)
        if not data:
            raise HTTPException(status_code=404, detail="Album not found")
        data["is_favorite"] = is_favorite(album_id)
        data.setdefault("st", Status.Ok)
        data.setdefault("msg", "")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/chapter/{photo_id}")
def get_chapter(photo_id: str, album_id: str | None = None, eps_index: int = 0):
    try:
        try:
            data = jm_service.get_chapter_detail(photo_id)
            images = data.get("images") or []
            out_images: list[str] = []
            for x in images:
                s = str(x or "")
                if not s:
                    continue
                if s.startswith("http://") or s.startswith("https://"):
                    try:
                        out_images.append(urlparse(s).path.rsplit("/", 1)[-1])
                    except Exception:
                        out_images.append(s.rsplit("/", 1)[-1])
                else:
                    out_images.append(s.rsplit("/", 1)[-1])
            data["images"] = out_images
        except Exception:
            chapter_raw = GetBookEpsInfoReq2(album_id or "0", photo_id).execute()
            tpl_raw = GetBookEpsScrambleReq2(album_id or "0", eps_index, photo_id).execute()
            tpl_info = parse_chapter_view_template(tpl_raw if isinstance(tpl_raw, str) else "")
            data = adapt_chapter_detail(chapter_raw, tpl_info, photo_id)
        data.setdefault("st", Status.Ok)
        data.setdefault("msg", "")
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/favorites")
def get_favorites(page: int = 1, folder_id: str = "0"):
    try:
        raw = GetFavoritesReq2(page=page, fid=folder_id).execute()
        data = adapt_favorites(raw)
        try:
            ids = [str(it.get("album_id") or "") for it in (data.get("content") or []) if isinstance(it, dict)]
            add_favorite_ids([x for x in ids if x])
        except Exception:
            pass
        data.setdefault("st", Status.Ok)
        data.setdefault("msg", "")
        return data
    except Exception as e:
        if "HTTP 401" in str(e):
            return {"content": [], "total": 0, "pages": 1, "folders": [], "st": Status.NotLogin, "msg": "Not logged in"}
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/favorite/toggle")
def favorite_toggle(req: FavoriteToggleRequest):
    try:
        raw = AddAndDelFavoritesReq2(req.album_id).execute()
        if req.desired_state is not None:
            set_favorite(req.album_id, bool(req.desired_state))
        else:
            set_favorite(req.album_id, not is_favorite(req.album_id))
        return merge_ok({"result": raw}, msg="")
    except Exception as e:
        if "HTTP 401" in str(e):
            return err(Status.NotLogin, "Not logged in")
        return err(Status.Error, str(e))


@app.post("/api/favorite_folder")
def favorite_folder(req: FavoriteFolderRequest):
    t = (req.type or "").strip().lower()
    try:
        if t == "add":
            raw = AddFavoritesFoldReq2(req.folder_name or "").execute()
        elif t == "del":
            raw = DelFavoritesFoldReq2(req.folder_id or "").execute()
        elif t == "rename":
            fid = req.folder_id or ""
            name = req.folder_name or ""
            raw = RenameFavoritesFoldReq2(fid, name, rename_type="rename").execute()
            if isinstance(raw, dict) and str(raw.get("status") or "").lower() == "fail":
                raw2 = RenameFavoritesFoldReq2(fid, name, rename_type="edit").execute()
                if not (isinstance(raw2, dict) and str(raw2.get("status") or "").lower() == "fail"):
                    raw = raw2
        elif t == "move":
            raw = MoveFavoritesFoldReq2(req.album_id or "", req.folder_id or "").execute()
        else:
            return err(Status.UserError, "Invalid type")
        return merge_ok({"result": raw}, msg="")
    except Exception as e:
        if "HTTP 401" in str(e):
            return err(Status.NotLogin, "Not logged in")
        return err(Status.Error, str(e))


@app.get("/api/comments")
def get_comments(album_id: str = "", page: int = 1, mode: str = "manhua"):
    try:
        raw = GetCommentReq2(bookId=album_id, page=str(page), readMode=mode).execute()
        return ok(raw, msg="")
    except Exception as e:
        if "HTTP 401" in str(e):
            return err(Status.NotLogin, "Not logged in")
        return err(Status.Error, str(e))


@app.post("/api/comment")
def send_comment(req: CommentSendRequest):
    try:
        raw = SendCommentReq2(bookId=req.album_id, comment=req.comment, cid=req.comment_id or "").execute()
        if isinstance(raw, str) and raw.strip():
            return err(Status.Error, raw.strip())
        if isinstance(raw, dict) and str(raw.get("status") or "").lower() == "fail":
            return err(Status.Error, str(raw.get("msg") or "Failed to post comment"), data=raw)
        return ok(raw, msg="")
    except Exception as e:
        if "HTTP 401" in str(e):
            return err(Status.NotLogin, "Not logged in")
        msg = str(e) or "Failed to post comment"
        if msg.startswith("API Error:"):
            msg = msg[len("API Error:"):].strip()
        if "勿重复留言" in msg:
            return err(Status.UserError, msg)
        return err(Status.Error, msg)


@app.post("/api/comment/like")
def like_comment(req: CommentLikeRequest):
    try:
        raw = LikeCommentReq2(cid=req.cid).execute()
        if isinstance(raw, str) and raw.strip():
            return err(Status.Error, raw.strip())
        if isinstance(raw, dict) and str(raw.get("status") or "").lower() == "fail":
            return err(Status.Error, str(raw.get("msg") or "Failed to like comment"), data=raw)
        return ok(raw, msg="")
    except Exception as e:
        if "HTTP 401" in str(e):
            return err(Status.NotLogin, "Not logged in")
        msg = str(e) or "Failed to like comment"
        if msg.startswith("API Error:"):
            msg = msg[len("API Error:"):].strip()
        return err(Status.Error, msg)


@app.get("/api/history")
def get_history(page: int = 1):
    try:
        raw = GetHistoryReq2(page=page).execute()
        return ok(raw, msg="")
    except Exception as e:
        if "HTTP 401" in str(e):
            return err(Status.NotLogin, "Not logged in")
        return err(Status.Error, str(e))


@app.get("/api/task/promote")
def task_promote(page: str = "0"):
    try:
        data = GetIndexInfoReq2(page).execute()
        return ok(data, msg="")
    except Exception as e:
        return err(Status.Error, str(e))


@app.get("/api/task/latest")
def task_latest(page: str = "0"):
    try:
        data = GetLatestInfoReq2(page).execute()
        return ok(data, msg="")
    except Exception as e:
        return err(Status.Error, str(e))


@app.get("/api/image-proxy")
def image_proxy(url: str):
    if not url:
        raise HTTPException(status_code=400, detail="Missing URL")

    session = get_session()
    headers = {
        "Referer": "https://jmcomic.me/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    try:
        resp = session.get(url, headers=headers, stream=True, timeout=15, verify=False)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Image fetch failed")
        media_type = resp.headers.get("content-type") or "image/jpeg"
        return StreamingResponse(
            resp.iter_content(chunk_size=8192),
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/chapter_image/{photo_id}/{image_name}")
def chapter_image_proxy(photo_id: str, image_name: str, domain: str | None = None):
    session = get_session()
    headers = {
        "Referer": "https://jmcomic.me/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    try:
        host_candidates: list[str] = []
        if domain:
            host_candidates.append(domain)
        for u in GlobalConfig.PicUrlList.value:
            try:
                host = urlparse(u).netloc
                if host:
                    host_candidates.append(host)
            except Exception:
                continue
        if not host_candidates:
            host_candidates.append("cdn-msp.jmapinodeudzn.net")

        last_status = None
        for host in dict.fromkeys(host_candidates).keys():
            url = f"https://{host}/media/photos/{photo_id}/{image_name}"
            resp = session.get(url, headers=headers, stream=True, timeout=15, verify=False)
            last_status = resp.status_code
            if resp.status_code == 200:
                media_type = resp.headers.get("content-type") or "image/jpeg"
                return StreamingResponse(
                    resp.iter_content(chunk_size=8192),
                    media_type=media_type,
                    headers={"Cache-Control": "public, max-age=31536000"},
                )
        raise HTTPException(status_code=last_status or 404, detail="Image not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def cleanup_file(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        return


@app.get("/api/download_zip")
async def download_zip(album_id: str, background_tasks: BackgroundTasks):
    success, result = jm_service.download_album_zip(album_id)
    if not success:
        raise HTTPException(status_code=500, detail=f"Download failed: {result}")
    zip_path = str(result)
    background_tasks.add_task(cleanup_file, zip_path)
    return FileResponse(zip_path, filename=f"album_{album_id}.zip", media_type="application/zip")


@app.post("/api/download")
async def download_album(req: DownloadRequest):
    download_manager.add_task(req.album_id, req.chapter_ids)
    return {"status": "success", "message": f"Download task for {req.album_id} queued"}


@app.post("/api/download/tasks")
def create_download_task(req: DownloadTaskCreateRequest):
    try:
        chapters = [{"id": c.id, "title": c.title} for c in (req.chapters or []) if c.id]
        if not chapters:
            return err(Status.UserError, "No chapters selected")
        task = download_task_manager.create_task(req.album_id, req.album_title, chapters)
        return ok(task.to_public(), msg="")
    except Exception as e:
        return err(Status.Error, str(e))


@app.get("/api/download/tasks/{task_id}")
def get_download_task(task_id: str):
    task = download_task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return ok(task.to_public(), msg="")


@app.get("/api/download/tasks/{task_id}/download")
def download_task_zip(task_id: str):
    task = download_task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "completed" or not task.zip_path:
        raise HTTPException(status_code=400, detail="Task not completed")
    if not os.path.exists(task.zip_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(task.zip_path, filename=os.path.basename(task.zip_path), media_type="application/zip")


frontend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")


@app.get("/")
async def read_index():
    return FileResponse(os.path.join(frontend_path, "index.html"))


app.mount("/", StaticFiles(directory=frontend_path), name="static")


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("JM_AURA_HOST") or "0.0.0.0"
    port = int(os.environ.get("JM_AURA_PORT") or "8000")
    uvicorn.run(app, host=host, port=port)
