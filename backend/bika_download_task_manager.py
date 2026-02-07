import os
import re
import shutil
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from queue import Queue
from typing import Any
from urllib.parse import urlparse

import requests

from backend.core.bika_client import bika_client


def _safe_name(name: str, max_len: int = 80) -> str:
    s = str(name or "").strip()
    if not s:
        return "untitled"
    s = re.sub(r"[<>:\"/\\\\|?*]+", "_", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:max_len] if len(s) > max_len else s


def _normalize_image_name(x: Any) -> str:
    s = str(x or "").strip()
    if not s:
        return ""
    if s.startswith("http://") or s.startswith("https://"):
        try:
            return urlparse(s).path.rsplit("/", 1)[-1]
        except Exception:
            return s.rsplit("/", 1)[-1]
    return s.rsplit("/", 1)[-1]


@dataclass
class BikaDownloadTask:
    task_id: str
    comic_id: str
    comic_title: str
    chapters: list[dict[str, str]]
    status: str = "queued"
    stage: str = "queued"
    message: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    total_images: int = 0
    downloaded_images: int = 0
    zipped_files: int = 0
    total_zip_files: int = 0
    percent: float = 0.0
    zip_path: str | None = None

    def to_public(self, base_url: str = "", source: str = "bika") -> dict[str, Any]:
        download_url = ""
        if self.status == "completed" and self.zip_path:
            download_url = f"{base_url}/api/v2/{source}/download/tasks/{self.task_id}/download"
        return {
            "task_id": self.task_id,
            "comic_id": self.comic_id,
            "comic_title": self.comic_title,
            "status": self.status,
            "stage": self.stage,
            "message": self.message,
            "total_images": self.total_images,
            "downloaded_images": self.downloaded_images,
            "total_zip_files": self.total_zip_files,
            "zipped_files": self.zipped_files,
            "percent": round(float(self.percent), 4),
            "download_url": download_url,
        }


class BikaDownloadTaskManager:
    def __init__(self, base_dir: str):
        self.base_dir = base_dir
        os.makedirs(self.base_dir, exist_ok=True)
        self._tasks: dict[str, BikaDownloadTask] = {}
        self._lock = threading.Lock()
        self._queue: Queue[str] = Queue()
        self._worker = threading.Thread(target=self._run, daemon=True)
        self._worker.start()
        self._session = requests.Session()

    def create_task(self, comic_id: str, comic_title: str, chapters: list[dict[str, str]]) -> BikaDownloadTask:
        task_id = str(uuid.uuid4())
        t = BikaDownloadTask(task_id=task_id, comic_id=str(comic_id), comic_title=str(comic_title or ""), chapters=chapters)
        with self._lock:
            self._tasks[task_id] = t
        self._queue.put(task_id)
        return t

    def get_task(self, task_id: str) -> BikaDownloadTask | None:
        with self._lock:
            return self._tasks.get(task_id)

    def _update(self, task_id: str, **kwargs: Any) -> None:
        with self._lock:
            t = self._tasks.get(task_id)
            if not t:
                return
            for k, v in kwargs.items():
                setattr(t, k, v)
            t.updated_at = time.time()

    def _calc_percent(self, t: BikaDownloadTask) -> float:
        if t.status == "completed":
            return 1.0
        if t.status == "failed":
            return t.percent
        if t.stage == "zipping":
            base = 0.9
            if t.total_zip_files > 0:
                return base + 0.1 * min(1.0, t.zipped_files / t.total_zip_files)
            return base
        if t.stage == "downloading":
            if t.total_images > 0:
                return 0.9 * min(1.0, t.downloaded_images / t.total_images)
            return 0.0
        return 0.0

    def _run(self) -> None:
        while True:
            task_id = self._queue.get()
            t = self.get_task(task_id)
            if not t:
                continue
            try:
                self._execute_task(t)
            except Exception as e:
                self._update(task_id, status="failed", stage="failed", message=str(e))
            finally:
                cur = self.get_task(task_id)
                if cur:
                    self._update(task_id, percent=self._calc_percent(cur))
                self._queue.task_done()

    def _download_bytes(self, url: str) -> bytes:
        resp = self._session.get(url, timeout=25)
        if resp.status_code != 200 or not resp.content:
            raise Exception(f"HTTP {resp.status_code}")
        return resp.content

    def _execute_task(self, t: BikaDownloadTask) -> None:
        task_id = t.task_id
        task_dir = os.path.join(self.base_dir, task_id)
        work_dir = os.path.join(task_dir, "work")
        os.makedirs(work_dir, exist_ok=True)

        comic_folder = _safe_name(t.comic_title) if t.comic_title else str(t.comic_id)
        root_out = os.path.join(work_dir, comic_folder)
        os.makedirs(root_out, exist_ok=True)

        chapters = t.chapters or []
        if not chapters:
            raise Exception("No chapters selected")

        self._update(task_id, status="downloading", stage="downloading", message="Downloading...", downloaded_images=0, total_images=0, percent=0.0)

        chapter_meta: list[tuple[str, str, list[tuple[str, str]]]] = []
        total_images = 0

        for c in chapters:
            ep_id = str(c.get("id") or "").strip()
            title = str(c.get("title") or "").strip() or ep_id
            if not ep_id:
                continue
            page = 1
            media_urls: list[tuple[str, str]] = []
            while True:
                data = bika_client.request("GET", f"comics/{t.comic_id}/order/{ep_id}/pages?page={page}", require_auth=True)
                pages = ((data.get("data") or {}).get("pages")) if isinstance(data, dict) else None
                docs = (pages or {}).get("docs") if isinstance(pages, dict) else None
                pages_total = (pages or {}).get("pages") if isinstance(pages, dict) else None
                if isinstance(docs, list):
                    for doc in docs:
                        media = doc.get("media") if isinstance(doc, dict) else None
                        if isinstance(media, dict):
                            fs = media.get("fileServer")
                            path = media.get("path")
                            if fs and path:
                                media_urls.append((_normalize_image_name(path), f"{fs}/{path}"))
                if not isinstance(pages_total, int) or page >= pages_total:
                    break
                page += 1
            chapter_meta.append((ep_id, title, media_urls))
            total_images += len(media_urls)

        if total_images <= 0:
            raise Exception("No images found for selected chapters")

        self._update(task_id, total_images=total_images, message="Downloading images...", percent=self._calc_percent(self.get_task(task_id) or t))

        downloaded = 0
        for ep_id, title, media_urls in chapter_meta:
            chapter_folder = os.path.join(root_out, _safe_name(title))
            os.makedirs(chapter_folder, exist_ok=True)
            for idx, (name, url) in enumerate(media_urls):
                ext = os.path.splitext(name)[1] or ".jpg"
                fn = f"{idx+1:04d}{ext}"
                out_path = os.path.join(chapter_folder, fn)
                content = self._download_bytes(url)
                with open(out_path, "wb") as f:
                    f.write(content)
                downloaded += 1
                self._update(task_id, downloaded_images=downloaded, percent=self._calc_percent(self.get_task(task_id) or t))

        self._update(task_id, stage="zipping", message="Packaging...", percent=self._calc_percent(self.get_task(task_id) or t))

        zip_dir = os.path.join(task_dir, "zips")
        os.makedirs(zip_dir, exist_ok=True)
        zip_name = f"{_safe_name(t.comic_title) if t.comic_title else t.comic_id}_{task_id[:8]}.zip"
        zip_path = os.path.join(zip_dir, zip_name)

        file_paths: list[str] = []
        for base, _dirs, files in os.walk(root_out):
            for fn in files:
                file_paths.append(os.path.join(base, fn))
        self._update(task_id, total_zip_files=len(file_paths), zipped_files=0, percent=self._calc_percent(self.get_task(task_id) or t))

        zipped = 0
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for fp in file_paths:
                arcname = os.path.relpath(fp, work_dir)
                zf.write(fp, arcname)
                zipped += 1
                if zipped % 10 == 0 or zipped == len(file_paths):
                    self._update(task_id, zipped_files=zipped, percent=self._calc_percent(self.get_task(task_id) or t))

        shutil.rmtree(work_dir, ignore_errors=True)

        self._update(task_id, status="completed", stage="completed", message="Completed", zip_path=zip_path, percent=1.0)

