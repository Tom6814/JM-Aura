import hashlib
import os
import re
import shutil
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from io import BytesIO
from queue import Queue
from typing import Any
from urllib.parse import urlparse

from PIL import Image

from backend.core.config import GlobalConfig
from backend.core.http_session import get_session
from backend.jm_service import jm_service


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


def _get_segmentation_num(eps_id: int, scramble_id: int, picture_name: str) -> int:
    if eps_id < scramble_id:
        return 0
    if eps_id < 268850:
        return 10
    md5_hex = hashlib.md5((str(eps_id) + picture_name).encode("utf-8")).hexdigest()
    key_code = ord(md5_hex[-1])
    if eps_id > 421926:
        return (key_code % 8) * 2 + 2
    return (key_code % 10) * 2 + 2


def _decode_image_bytes(img_bytes: bytes, eps_id: int, scramble_id: int, picture_name: str, is_gif: bool) -> bytes:
    if is_gif:
        return img_bytes
    num = _get_segmentation_num(eps_id, scramble_id, picture_name)
    if num <= 1:
        return img_bytes

    src = BytesIO(img_bytes)
    with Image.open(src) as src_img:
        width, height = src_img.size
        des_img = Image.new(src_img.mode, (width, height))
        fmt = src_img.format

        rem = height % num
        copy_height = height // num
        blocks: list[tuple[int, int]] = []
        total_h = 0
        for i in range(num):
            h = copy_height * (i + 1)
            if i == num - 1:
                h += rem
            blocks.append((total_h, h))
            total_h = h

        dest_y = 0
        for start, end in reversed(blocks):
            slice_h = end - start
            temp = src_img.crop((0, start, width, end))
            des_img.paste(temp, (0, dest_y, width, dest_y + slice_h))
            dest_y += slice_h

        out = BytesIO()
        des_img.save(out, format=fmt)
        return out.getvalue()


def _candidate_hosts(domain: str | None) -> list[str]:
    out: list[str] = []
    if domain:
        d = str(domain).strip()
        if d:
            d = d.replace("https://", "").replace("http://", "").strip("/")
            out.append(d)
    for u in GlobalConfig.PicUrlList.value:
        try:
            host = urlparse(u).netloc
            if host:
                out.append(host)
        except Exception:
            continue
    out.append("cdn-msp.jmapinodeudzn.net")
    return list(dict.fromkeys(out).keys())


def _download_one_image(photo_id: str, image_name: str, domain: str | None) -> tuple[bytes, str]:
    session = get_session()
    headers = {
        "Referer": "https://jmcomic.me/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept-encoding": "gzip",
    }
    last_err = None
    for host in _candidate_hosts(domain):
        url = f"https://{host}/media/photos/{photo_id}/{image_name}"
        try:
            resp = session.get(url, headers=headers, timeout=25, verify=False)
            if resp.status_code == 200 and resp.content:
                return resp.content, host
            last_err = Exception(f"HTTP {resp.status_code}")
        except Exception as e:
            last_err = e
            continue
    raise Exception(f"Image download failed: {photo_id}/{image_name} ({last_err})")


@dataclass
class DownloadTask:
    task_id: str
    album_id: str
    album_title: str
    chapters: list[dict[str, str]]
    status: str = "queued"  # queued|downloading|zipping|completed|failed
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

    def to_public(self, base_url: str = "") -> dict[str, Any]:
        download_url = ""
        if self.status == "completed" and self.zip_path:
            download_url = f"{base_url}/api/download/tasks/{self.task_id}/download"
        return {
            "task_id": self.task_id,
            "album_id": self.album_id,
            "album_title": self.album_title,
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


class DownloadTaskManager:
    def __init__(self, base_dir: str):
        self.base_dir = base_dir
        os.makedirs(self.base_dir, exist_ok=True)
        self._tasks: dict[str, DownloadTask] = {}
        self._lock = threading.Lock()
        self._queue: Queue[str] = Queue()
        self._worker = threading.Thread(target=self._run, daemon=True)
        self._worker.start()

    def create_task(self, album_id: str, album_title: str, chapters: list[dict[str, str]]) -> DownloadTask:
        task_id = str(uuid.uuid4())
        t = DownloadTask(task_id=task_id, album_id=str(album_id), album_title=str(album_title or ""), chapters=chapters)
        with self._lock:
            self._tasks[task_id] = t
        self._queue.put(task_id)
        return t

    def get_task(self, task_id: str) -> DownloadTask | None:
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

    def _calc_percent(self, t: DownloadTask) -> float:
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

    def _execute_task(self, t: DownloadTask) -> None:
        task_id = t.task_id
        task_dir = os.path.join(self.base_dir, task_id)
        work_dir = os.path.join(task_dir, "work")
        os.makedirs(work_dir, exist_ok=True)

        album_folder = _safe_name(t.album_title) if t.album_title else str(t.album_id)
        root_out = os.path.join(work_dir, album_folder)
        os.makedirs(root_out, exist_ok=True)

        chapters = t.chapters or []
        if not chapters:
            raise Exception("No chapters selected")

        self._update(task_id, status="downloading", stage="downloading", message="Downloading...", downloaded_images=0, total_images=0, percent=0.0)

        chapter_meta: list[tuple[str, str, str, int, list[str]]] = []
        total_images = 0
        for c in chapters:
            photo_id = str(c.get("id") or "").strip()
            title = str(c.get("title") or "").strip() or photo_id
            if not photo_id:
                continue
            ch = jm_service.get_chapter_detail(photo_id)
            scramble_id = int(ch.get("scramble_id") or 220980)
            if scramble_id <= 0:
                scramble_id = 220980
            domain = ch.get("data_original_domain")
            images = ch.get("images") or []
            img_names = [_normalize_image_name(x) for x in images]
            img_names = [x for x in img_names if x]
            chapter_meta.append((photo_id, title, str(domain or ""), scramble_id, img_names))
            total_images += len(img_names)

        if total_images <= 0:
            raise Exception("No images found for selected chapters")

        self._update(task_id, total_images=total_images, message="Downloading images...", percent=self._calc_percent(self.get_task(task_id) or t))

        downloaded = 0
        for photo_id, title, domain, scramble_id, img_names in chapter_meta:
            chapter_folder = os.path.join(root_out, _safe_name(title))
            os.makedirs(chapter_folder, exist_ok=True)
            eps_id = int(photo_id)
            for img_name in img_names:
                is_gif = img_name.lower().endswith(".gif")
                raw_bytes, _host = _download_one_image(photo_id, img_name, domain or None)
                pic_name = img_name.split(".", 1)[0]
                try:
                    out_bytes = _decode_image_bytes(raw_bytes, eps_id=eps_id, scramble_id=scramble_id, picture_name=pic_name, is_gif=is_gif)
                except Exception:
                    out_bytes = raw_bytes
                out_path = os.path.join(chapter_folder, img_name)
                with open(out_path, "wb") as f:
                    f.write(out_bytes)
                downloaded += 1
                self._update(task_id, downloaded_images=downloaded, percent=self._calc_percent(self.get_task(task_id) or t))

        self._update(task_id, stage="zipping", message="Packaging...", percent=self._calc_percent(self.get_task(task_id) or t))

        zip_dir = os.path.join(task_dir, "zips")
        os.makedirs(zip_dir, exist_ok=True)
        zip_name = f"{_safe_name(t.album_title) if t.album_title else t.album_id}_{task_id[:8]}.zip"
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
