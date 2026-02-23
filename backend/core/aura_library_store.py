from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

from backend.core.paths import app_data_dir


def _store_path() -> str:
    if os.environ.get("JM_AURA_AURA_LIBRARY_PATH"):
        return os.environ["JM_AURA_AURA_LIBRARY_PATH"]
    if getattr(sys, "frozen", False):
        return os.path.join(app_data_dir(), "aura_library.json")
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_dir, "backend", "config", "aura_library.json")


def _load_raw() -> dict[str, Any]:
    p = _store_path()
    if not os.path.exists(p):
        return {"v": 1, "users": {}}
    try:
        with open(p, "r", encoding="utf-8") as f:
            v = json.load(f)
        if not isinstance(v, dict):
            return {"v": 1, "users": {}}
        if "users" not in v or not isinstance(v.get("users"), dict):
            v["users"] = {}
        return v
    except Exception:
        return {"v": 1, "users": {}}


def _save_raw(data: dict[str, Any]) -> None:
    p = _store_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _user_bucket(raw: dict[str, Any], user: str) -> dict[str, Any]:
    users = raw.get("users")
    if not isinstance(users, dict):
        users = {}
        raw["users"] = users
    u = str(user or "").strip()
    if not u:
        raise ValueError("Missing user")
    b = users.get(u)
    if not isinstance(b, dict):
        b = {}
        users[u] = b
    if "history" not in b or not isinstance(b.get("history"), dict):
        b["history"] = {}
    if "folders" not in b or not isinstance(b.get("folders"), dict):
        b["folders"] = {}
    if "notes" not in b or not isinstance(b.get("notes"), dict):
        b["notes"] = {}
    return b


def push_history(user: str, album_id: str, *, album_title: str = "", photo_id: str = "", title: str = "", ts: int | None = None) -> None:
    aid = str(album_id or "").strip()
    if not aid:
        raise ValueError("Missing album_id")
    raw = _load_raw()
    b = _user_bucket(raw, user)
    h = b["history"]
    now = int(ts or time.time() * 1000)
    rec = h.get(aid)
    if not isinstance(rec, dict):
        rec = {}
        h[aid] = rec
    if album_title:
        rec["album_title"] = str(album_title)
    if photo_id:
        rec["photo_id"] = str(photo_id)
    if title:
        rec["title"] = str(title)
    rec["timestamp"] = now
    _save_raw(raw)


def list_history(user: str, *, limit: int = 50) -> list[dict[str, Any]]:
    raw = _load_raw()
    b = _user_bucket(raw, user)
    h = b.get("history")
    if not isinstance(h, dict):
        return []
    out = []
    for aid, v in h.items():
        if not isinstance(v, dict):
            continue
        out.append(
            {
                "album_id": str(aid),
                "album_title": str(v.get("album_title") or ""),
                "photo_id": str(v.get("photo_id") or ""),
                "title": str(v.get("title") or ""),
                "timestamp": int(v.get("timestamp") or 0),
            }
        )
    out.sort(key=lambda x: int(x.get("timestamp") or 0), reverse=True)
    return out[: max(1, int(limit or 50))]


def create_folder(user: str, name: str) -> dict[str, Any]:
    n = str(name or "").strip()
    if not n:
        raise ValueError("Missing folder name")
    raw = _load_raw()
    b = _user_bucket(raw, user)
    folders = b["folders"]
    fid = f"f_{int(time.time()*1000)}"
    folders[fid] = {"id": fid, "name": n, "album_ids": [], "created_at": int(time.time())}
    _save_raw(raw)
    return folders[fid]


def rename_folder(user: str, folder_id: str, name: str) -> None:
    fid = str(folder_id or "").strip()
    n = str(name or "").strip()
    if not fid or not n:
        raise ValueError("Missing folder_id or name")
    raw = _load_raw()
    b = _user_bucket(raw, user)
    folders = b["folders"]
    f = folders.get(fid)
    if not isinstance(f, dict):
        raise ValueError("Folder not found")
    f["name"] = n
    _save_raw(raw)


def delete_folder(user: str, folder_id: str) -> None:
    fid = str(folder_id or "").strip()
    if not fid:
        raise ValueError("Missing folder_id")
    raw = _load_raw()
    b = _user_bucket(raw, user)
    folders = b["folders"]
    folders.pop(fid, None)
    _save_raw(raw)


def toggle_folder_item(user: str, folder_id: str, album_id: str, present: bool) -> None:
    fid = str(folder_id or "").strip()
    aid = str(album_id or "").strip()
    if not fid or not aid:
        raise ValueError("Missing folder_id or album_id")
    raw = _load_raw()
    b = _user_bucket(raw, user)
    folders = b["folders"]
    f = folders.get(fid)
    if not isinstance(f, dict):
        raise ValueError("Folder not found")
    ids = f.get("album_ids")
    if not isinstance(ids, list):
        ids = []
        f["album_ids"] = ids
    s = set(str(x) for x in ids if str(x))
    if present:
        s.add(aid)
    else:
        s.discard(aid)
    f["album_ids"] = sorted(s)
    _save_raw(raw)


def list_folders(user: str) -> list[dict[str, Any]]:
    raw = _load_raw()
    b = _user_bucket(raw, user)
    folders = b.get("folders")
    if not isinstance(folders, dict):
        return []
    out = []
    for fid, f in folders.items():
        if not isinstance(f, dict):
            continue
        ids = f.get("album_ids")
        out.append(
            {
                "id": str(fid),
                "name": str(f.get("name") or ""),
                "count": len(ids) if isinstance(ids, list) else 0,
            }
        )
    out.sort(key=lambda x: x["name"])
    return out


def list_folders_with_album_ids(user: str) -> list[dict[str, Any]]:
    raw = _load_raw()
    b = _user_bucket(raw, user)
    folders = b.get("folders")
    if not isinstance(folders, dict):
        return []
    out = []
    for fid, f in folders.items():
        if not isinstance(f, dict):
            continue
        ids = f.get("album_ids")
        album_ids = [str(x) for x in ids] if isinstance(ids, list) else []
        album_ids = [x.strip() for x in album_ids if str(x).strip()]
        out.append(
            {
                "id": str(fid),
                "name": str(f.get("name") or ""),
                "album_ids": sorted(set(album_ids)),
                "count": len(set(album_ids)),
            }
        )
    out.sort(key=lambda x: x["name"])
    return out


def set_note(user: str, album_id: str, *, tags: list[str] | None = None, note: str = "") -> None:
    aid = str(album_id or "").strip()
    if not aid:
        raise ValueError("Missing album_id")
    raw = _load_raw()
    b = _user_bucket(raw, user)
    notes = b["notes"]
    rec = notes.get(aid)
    if not isinstance(rec, dict):
        rec = {}
        notes[aid] = rec
    if isinstance(tags, list):
        cleaned = []
        for t in tags:
            s = str(t or "").strip()
            if s and len(s) <= 24:
                cleaned.append(s)
        uniq = []
        for x in cleaned:
            if x not in uniq:
                uniq.append(x)
        rec["tags"] = uniq[:20]
    if isinstance(note, str):
        rec["note"] = note[:2000]
    rec["updated_at"] = int(time.time())
    _save_raw(raw)


def get_note(user: str, album_id: str) -> dict[str, Any]:
    aid = str(album_id or "").strip()
    if not aid:
        return {}
    raw = _load_raw()
    b = _user_bucket(raw, user)
    notes = b.get("notes")
    if not isinstance(notes, dict):
        return {}
    rec = notes.get(aid)
    return rec if isinstance(rec, dict) else {}


def summary(user: str) -> dict[str, Any]:
    hist = list_history(user, limit=12)
    folders = list_folders(user)
    return {"history": hist, "folders": folders}
