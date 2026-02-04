from __future__ import annotations

import os
import re
import threading
from queue import Queue
from typing import Any
from urllib.parse import urlparse

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.core.api_adapter import adapt_album_detail, adapt_chapter_detail, adapt_favorites, adapt_search_result
from backend.core.config import GlobalConfig
from backend.core.http_session import clear_cookies, get_session, save_cookies
from backend.core.parsers import parse_chapter_view_template
from backend.core.status import Status
from backend.core.task_res import merge_ok, ok, err
from backend.core.req import (
    AddAndDelFavoritesReq2,
    AddFavoritesFoldReq2,
    DelFavoritesFoldReq2,
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


app = FastAPI(title="JM-Dashboard")


class ConfigRequest(BaseModel):
    username: str
    password: str


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
        LoginReq2(config.username, config.password).execute()
    except Exception:
        raise HTTPException(status_code=401, detail="Login failed. Please check your username and password.")

    save_cookies()

    if not jm_service.update_config(config.username, config.password):
        raise HTTPException(status_code=500, detail="Failed to save configuration")

    return {"status": "success", "message": "Login successful and configuration updated", "st": Status.Ok, "msg": ""}


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
    if jm_service.update_config("", ""):
        return {"status": "success", "message": "Logged out", "st": Status.Ok, "msg": ""}
    raise HTTPException(status_code=500, detail="Logout failed")


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

    uvicorn.run(app, host="0.0.0.0", port=8000)
