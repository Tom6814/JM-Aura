from typing import Any

from backend.core.config import GlobalConfig
import math
from datetime import datetime, timezone


def _album_cover_url(album_id: str) -> str:
    base = GlobalConfig.GetImgUrl()
    return f"{base}/media/albums/{album_id}.jpg"

def _maybe_format_timestamp(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        v = value.strip()
        if v.isdigit():
            try:
                return _maybe_format_timestamp(int(v))
            except Exception:
                return v
        return v
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 10_000_000_000:
            ts = ts / 1000.0
        try:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return ""
    return str(value).strip()


def _extract_tags(data: dict[str, Any]) -> list[str]:
    candidates = [
        data.get("tags"),
        data.get("tag_list"),
        data.get("tag"),
        data.get("keywords"),
        data.get("keyword"),
    ]
    out: list[str] = []

    def _add(x: str) -> None:
        s = (x or "").strip()
        if not s:
            return
        if s in out:
            return
        out.append(s)

    for c in candidates:
        if not c:
            continue
        if isinstance(c, str):
            for part in c.replace("，", ",").split(","):
                _add(part)
            continue
        if isinstance(c, list):
            for it in c:
                if isinstance(it, str):
                    _add(it)
                    continue
                if isinstance(it, dict):
                    _add(str(it.get("title") or it.get("name") or it.get("tag") or ""))
            continue
        if isinstance(c, dict):
            _add(str(c.get("title") or c.get("name") or ""))

    return out


def _extract_update_time(data: dict[str, Any]) -> str:
    for k in ("update_time", "update_at", "updated_at", "update", "last_update", "last_updated", "update_date", "addtime"):
        if k in data and data.get(k) not in (None, ""):
            return _maybe_format_timestamp(data.get(k))
    return ""


def adapt_search_result(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        return []
    content = data.get("content") or []
    if not isinstance(content, list):
        return []

    results: list[dict[str, Any]] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        album_id = str(item.get("id") or "")
        if not album_id:
            continue
        category = ""
        cat_obj = item.get("category")
        if isinstance(cat_obj, dict):
            category = str(cat_obj.get("title") or "")
        elif cat_obj is not None:
            category = str(cat_obj)

        image = item.get("image") or ""
        if not image:
            image = _album_cover_url(album_id)

        results.append(
            {
                "album_id": album_id,
                "title": str(item.get("name") or ""),
                "author": str(item.get("author") or ""),
                "category": category,
                "image": str(image),
            }
        )
    return results


def adapt_album_detail(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {}

    album_id = str(data.get("id") or "")
    if not album_id:
        return {}

    series = data.get("series") or []
    episode_list: list[dict[str, Any]] = []
    if isinstance(series, list) and series:
        for idx, ep in enumerate(series):
            if not isinstance(ep, dict):
                continue
            ep_id = str(ep.get("id") or "")
            if not ep_id:
                continue
            title = str(ep.get("name") or "").strip()
            if not title:
                sort = ep.get("sort")
                title = f"第 {sort or (idx + 1)} 话"
            ep_update_time = ""
            if isinstance(ep, dict):
                ep_update_time = _extract_update_time(ep)
            episode_list.append({"id": ep_id, "title": title, "update_time": ep_update_time})
    else:
        episode_list.append({"id": album_id, "title": "第 1 话", "update_time": ""})

    image = _album_cover_url(album_id)
    tags = _extract_tags(data)
    update_time = _extract_update_time(data)

    return {
        "album_id": album_id,
        "title": str(data.get("name") or ""),
        "author": str(data.get("author") or ""),
        "description": data.get("description") or "",
        "tags": tags,
        "update_time": update_time,
        "episode_list": episode_list,
        "image_count": len(episode_list),
        "image": image,
    }


def adapt_favorites(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {"content": [], "total": 0, "pages": 1, "folders": []}

    content = data.get("content") or data.get("list") or []
    if not isinstance(content, list):
        content = []

    out: list[dict[str, Any]] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        album_id = str(item.get("id") or item.get("album_id") or "")
        if not album_id:
            continue
        image = item.get("image") or _album_cover_url(album_id)
        category = ""
        cat_obj = item.get("category")
        if isinstance(cat_obj, dict):
            category = str(cat_obj.get("title") or "")
        elif cat_obj is not None:
            category = str(cat_obj)

        out.append(
            {
                "album_id": album_id,
                "title": str(item.get("name") or item.get("title") or ""),
                "author": str(item.get("author") or ""),
                "image": str(image),
                "category": category or "Favorite",
            }
        )

    folders = data.get("folder_list") or data.get("folders") or []
    folder_out: list[dict[str, str]] = []
    if isinstance(folders, list):
        for f in folders:
            if isinstance(f, dict):
                folder_out.append(
                    {
                        "id": str(f.get("FID") or f.get("id") or "0"),
                        "name": str(f.get("name") or ""),
                    }
                )

    total = int(data.get("total") or 0)
    page_size = int(data.get("count") or len(content) or 0)
    pages = int(data.get("page_count") or data.get("pages") or 0)
    if pages <= 0:
        if total > 0 and page_size > 0:
            pages = int(math.ceil(total / page_size))
        else:
            pages = 1

    return {
        "content": out,
        "total": total,
        "pages": pages,
        "folders": folder_out,
    }


def adapt_chapter_detail(chapter_data: Any, template_data: Any, photo_id: str) -> dict[str, Any]:
    images: list[str] = []
    title = ""
    album_id = ""
    index = 0

    if isinstance(chapter_data, dict):
        title = str(chapter_data.get("name") or "")
        album_id = str(chapter_data.get("series_id") or chapter_data.get("album_id") or "")
        imgs = chapter_data.get("images") or []
        if isinstance(imgs, list):
            images = [str(x) for x in imgs if x]

    scramble_id = "0"
    data_original_domain = None
    if isinstance(template_data, dict):
        scramble_id = str(template_data.get("scramble_id") or "0")
        data_original_domain = template_data.get("data_original_domain")

    return {
        "photo_id": str(photo_id),
        "album_id": album_id,
        "scramble_id": scramble_id,
        "data_original_domain": data_original_domain,
        "images": images,
        "title": title,
        "index": index,
    }
