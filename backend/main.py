from __future__ import annotations

import os
import copy
import re
import shutil
import threading
import time
import io
from queue import Queue
from typing import Any
from urllib.parse import urlparse

import requests
from fastapi import BackgroundTasks, FastAPI, HTTPException, UploadFile, File, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.core.api_adapter import adapt_album_detail, adapt_chapter_detail, adapt_favorites, adapt_search_result
from backend.core.config import GlobalConfig
from backend.core.http_session import clear_cookies, get_session, migrate_legacy_cookies_to_user, save_cookies
from backend.core.jm_context import current_jm_identity
from backend.core.jm_store import add_favorite_ids, clear_current_user_data, is_favorite, set_favorite, set_favorite_ids, set_user_id, set_user_profile
from backend.core.site_profile_store import get_profile as get_site_profile, patch_profile as patch_site_profile
from backend.core.aura_library_store import (
    create_folder as aura_create_folder,
    delete_folder as aura_delete_folder,
    get_note as aura_get_note,
    list_folders as aura_list_folders,
    list_folders_with_album_ids as aura_list_folders_with_album_ids,
    list_history as aura_list_history,
    push_history as aura_push_history,
    rename_folder as aura_rename_folder,
    set_note as aura_set_note,
    summary as aura_summary,
    toggle_folder_item as aura_toggle_folder_item,
)
from backend.core.parsers import parse_chapter_view_template
from backend.core.secure_credentials import clear_credentials, get_credentials, get_username, has_credentials, list_accounts, remove_account, set_active, set_credentials
from backend.core.site_auth import (
    clear_session as clear_site_session,
    create_session as create_site_session,
    create_user as create_site_user,
    current_site_user,
    get_effective_user,
    get_current_user as get_site_user,
    get_guest_cookie_name as get_site_guest_cookie_name,
    get_session_cookie_name as get_site_session_cookie_name,
    has_any_user as has_any_site_user,
    is_admin as is_site_admin,
    site_auth_middleware_allow,
    verify_user as verify_site_user,
)
from backend.core.status import Status
from backend.core.task_res import merge_ok, ok, err
from backend.core.req import (
    AddAndDelFavoritesReq2,
    AddFavoritesFoldReq2,
    DelFavoritesFoldReq2,
    RenameFavoritesFoldReq2,
    RegisterReq,
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
app.add_middleware(GZipMiddleware, minimum_size=800)

register_provider("jm", JmProvider())

_PROMOTE_CACHE: dict[str, tuple[float, Any]] = {}
_PROMOTE_CACHE_LOCK = threading.Lock()
_PROMOTE_TTL_SEC = 5.0

_JM_REGISTER_SESSIONS: dict[str, requests.Session] = {}
_JM_REGISTER_SESSIONS_LOCK = threading.Lock()


def _get_jm_register_session(site_user: str) -> requests.Session:
    key = str(site_user or "").strip() or "anon"
    with _JM_REGISTER_SESSIONS_LOCK:
        s = _JM_REGISTER_SESSIONS.get(key)
        if s is not None:
            return s
        s = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20)
        s.mount("http://", adapter)
        s.mount("https://", adapter)
        _JM_REGISTER_SESSIONS[key] = s
        return s


def _jm_web_headers(referer: str | None = None) -> dict[str, str]:
    h: dict[str, str] = {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        "pragma": "no-cache",
    }
    if referer:
        h["referer"] = str(referer)
    return h


@app.middleware("http")
async def site_auth_middleware(request: Request, call_next):
    if site_auth_middleware_allow(request.url.path):
        return await call_next(request)
    u, is_auth, new_gid = get_effective_user(request)
    token = current_site_user.set(u)
    jm_token = None
    try:
        identity = str(u or "").strip() or "anon"
        if is_auth:
            try:
                active_jm = get_username(user=identity)
                if active_jm:
                    identity = f"{identity}#jm#{active_jm}"
            except Exception:
                pass
        jm_token = current_jm_identity.set(identity)
    except Exception:
        jm_token = current_jm_identity.set(str(u or "").strip() or "anon")
    try:
        resp = await call_next(request)
        if new_gid:
            resp.set_cookie(
                get_site_guest_cookie_name(),
                new_gid,
                httponly=True,
                samesite="lax",
                secure=(request.url.scheme == "https"),
                max_age=365 * 86400,
            )
        return resp
    finally:
        try:
            if jm_token is not None:
                current_jm_identity.reset(jm_token)
        except Exception:
            pass
        current_site_user.reset(token)

def _migrate_op_yml_credentials(target_site_user: str) -> None:
    try:
        import yaml
    except Exception:
        yaml = None
    if not yaml:
        return
    try:
        if not jm_service or not getattr(jm_service, "config_path", None):
            return
        p = str(jm_service.config_path)
        if not p or not os.path.exists(p):
            return
        with open(p, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        if not isinstance(cfg, dict):
            return
        client_cfg = cfg.get("client") if isinstance(cfg.get("client"), dict) else {}
        u = str((client_cfg or {}).get("username") or "").strip()
        pw = str((client_cfg or {}).get("password") or "").strip()
        if u and pw and not has_credentials(user=target_site_user):
            try:
                set_credentials(u, pw, user=target_site_user)
            except Exception:
                pass
        if ("username" in (client_cfg or {})) or ("password" in (client_cfg or {})):
            try:
                jm_service.update_config("", "")
            except Exception:
                pass
    except Exception:
        return


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


class SiteAuthRequest(BaseModel):
    username: str
    password: str


class SiteProfileRequest(BaseModel):
    theme: dict[str, Any] | None = None
    features: dict[str, Any] | None = None


@app.post("/api/site/admin/create-user")
def site_admin_create_user(req: SiteAuthRequest, request: Request):
    admin_u = get_site_user(request)
    if not admin_u or not is_site_admin(admin_u):
        return JSONResponse(err(Status.UserError, "Forbidden"), status_code=403)
    try:
        create_site_user(req.username, req.password, admin=False)
    except ValueError as e:
        return err(Status.UserError, str(e) or "Invalid username or password")
    except Exception as e:
        return JSONResponse(err(Status.Error, str(e) or "Create failed"), status_code=500)
    return ok({"status": "success"}, msg="")


@app.get("/api/jm/binding")
def jm_binding_status(request: Request):
    site_u = get_site_user(request)
    site_logged_in = bool(site_u)
    has_saved = bool(has_credentials(user=site_u)) if site_u else False
    saved_jm_username = get_username(user=site_u) if site_u else ""
    sess = get_session()
    jm_logged_in = bool(sess.cookies.get_dict())
    jm_username = ""
    accounts_count = 0
    try:
        if site_u:
            li = list_accounts(user=site_u)
            accounts = li.get("accounts") if isinstance(li, dict) else None
            if isinstance(accounts, list):
                accounts_count = len(accounts)
    except Exception:
        accounts_count = 0
    return ok(
        {
            "site_logged_in": site_logged_in,
            "site_username": site_u or "",
            "can_save_credentials": site_logged_in,
            "has_saved_credentials": has_saved,
            "saved_jm_username": saved_jm_username,
            "jm_logged_in": jm_logged_in,
            "jm_username": jm_username,
            "jm_accounts_count": accounts_count,
        },
        msg="",
    )


@app.post("/api/jm/unbind")
def jm_unbind(request: Request):
    clear_cookies()
    clear_current_user_data()
    site_u = get_site_user(request)
    if site_u:
        try:
            clear_credentials(user=site_u)
        except Exception:
            pass
    return ok({"status": "success"}, msg="")


@app.get("/api/site/status")
def site_status():
    return ok({"has_users": bool(has_any_site_user())}, msg="")


@app.post("/api/site/register")
def site_register(req: SiteAuthRequest, request: Request):
    admin_flag = not has_any_site_user()
    try:
        create_site_user(req.username, req.password, admin=admin_flag)
    except ValueError as e:
        return err(Status.UserError, str(e) or "Invalid username or password")
    except Exception as e:
        return JSONResponse(err(Status.Error, str(e) or "Registration failed"), status_code=500)
    sid = create_site_session(req.username)
    try:
        _migrate_op_yml_credentials(str(req.username or "").strip())
    except Exception:
        pass
    try:
        migrate_legacy_cookies_to_user(str(req.username or "").strip())
    except Exception:
        pass
    resp = JSONResponse(ok({"username": req.username, "is_admin": bool(admin_flag)}, msg=""))
    resp.set_cookie(
        get_site_session_cookie_name(),
        sid,
        httponly=True,
        samesite="lax",
        secure=(request.url.scheme == "https"),
        max_age=7 * 86400,
    )
    return resp


@app.post("/api/site/login")
def site_login(req: SiteAuthRequest, request: Request):
    if not verify_site_user(req.username, req.password):
        return JSONResponse(err(Status.UserError, "Login failed"), status_code=401)
    sid = create_site_session(req.username)
    try:
        _migrate_op_yml_credentials(str(req.username or "").strip())
    except Exception:
        pass
    try:
        migrate_legacy_cookies_to_user(str(req.username or "").strip())
    except Exception:
        pass
    resp = JSONResponse(ok({"username": req.username, "is_admin": bool(is_site_admin(req.username))}, msg=""))
    resp.set_cookie(
        get_site_session_cookie_name(),
        sid,
        httponly=True,
        samesite="lax",
        secure=(request.url.scheme == "https"),
        max_age=7 * 86400,
    )
    return resp


@app.post("/api/site/logout")
def site_logout(request: Request):
    sid = str(request.cookies.get(get_site_session_cookie_name()) or "")
    clear_site_session(sid)
    resp = JSONResponse(ok({"status": "success"}, msg=""))
    resp.delete_cookie(get_site_session_cookie_name())
    return resp


@app.get("/api/site/me")
def site_me(request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    return ok({"username": u, "is_admin": bool(is_site_admin(u))}, msg="")


@app.get("/api/site/profile")
def site_profile_get(request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    return ok(get_site_profile(u), msg="")


@app.post("/api/site/profile")
def site_profile_patch(req: SiteProfileRequest, request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    patch: dict[str, Any] = {}
    if isinstance(req.theme, dict):
        patch["theme"] = req.theme
    if isinstance(req.features, dict):
        patch["features"] = req.features
    return ok(patch_site_profile(u, patch), msg="")


class AuraHistoryPushRequest(BaseModel):
    album_id: str
    album_title: str | None = None
    photo_id: str | None = None
    title: str | None = None
    timestamp: int | None = None


class AuraFolderCreateRequest(BaseModel):
    name: str


class AuraFolderRenameRequest(BaseModel):
    folder_id: str
    name: str


class AuraFolderDeleteRequest(BaseModel):
    folder_id: str


class AuraFolderToggleItemRequest(BaseModel):
    folder_id: str
    album_id: str
    present: bool


class AuraNoteSetRequest(BaseModel):
    album_id: str
    tags: list[str] | None = None
    note: str | None = None


class AuraSyncToJmRequest(BaseModel):
    folder_ids: list[str] | None = None
    create_missing_folders: bool = True


@app.get("/api/aura/library/summary")
def aura_library_summary(request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    return ok(aura_summary(u), msg="")


@app.get("/api/aura/library/history")
def aura_library_history(request: Request, limit: int = 50):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    return ok(aura_list_history(u, limit=limit), msg="")


@app.post("/api/aura/library/history")
def aura_library_history_push(req: AuraHistoryPushRequest, request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    try:
        aura_push_history(
            u,
            req.album_id,
            album_title=str(req.album_title or ""),
            photo_id=str(req.photo_id or ""),
            title=str(req.title or ""),
            ts=req.timestamp,
        )
    except Exception as e:
        return err(Status.UserError, str(e) or "Invalid request")
    return ok({"status": "success"}, msg="")


@app.post("/api/aura/library/sync-to-jm")
def aura_library_sync_to_jm(req: AuraSyncToJmRequest, request: Request):
    aura_u = get_site_user(request)
    if not aura_u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)

    def _fetch_remote_favs() -> tuple[set[str], dict[str, str]]:
        r0 = GetFavoritesReq2(page=1, fid="0")
        r0.timeout = 8
        raw0 = r0.execute()
        d0 = adapt_favorites(raw0)
        folders = d0.get("folders") if isinstance(d0, dict) else []
        folder_map: dict[str, str] = {}
        if isinstance(folders, list):
            for f in folders:
                if not isinstance(f, dict):
                    continue
                name = str(f.get("name") or "").strip()
                fid = str(f.get("id") or "").strip()
                if name and fid and name not in folder_map:
                    folder_map[name] = fid
        pages = int(d0.get("pages") or 1) if isinstance(d0, dict) else 1
        pages = max(1, min(80, pages))
        ids: set[str] = set()
        for page in range(1, pages + 1):
            rp = GetFavoritesReq2(page=page, fid="0")
            rp.timeout = 10
            raw = rp.execute()
            dp = adapt_favorites(raw)
            content = dp.get("content") if isinstance(dp, dict) else []
            if isinstance(content, list):
                for it in content:
                    if isinstance(it, dict):
                        aid = str(it.get("album_id") or "").strip()
                        if aid:
                            ids.add(aid)
        return ids, folder_map

    def _create_remote_folder(name: str) -> str:
        r = AddFavoritesFoldReq2(name)
        r.timeout = 10
        r.execute()
        _, fm = _fetch_remote_favs()
        return str(fm.get(name) or "").strip()

    def _run() -> dict:
        local = aura_list_folders_with_album_ids(aura_u)
        want_ids = set(str(x) for x in (req.folder_ids or []) if str(x).strip())
        if want_ids:
            local = [f for f in local if str(f.get("id") or "") in want_ids]

        remote_ids, remote_folder_by_name = _fetch_remote_favs()

        created_folders = 0
        added_favorites = 0
        moved = 0
        skipped = 0
        duplicates = 0
        processed: set[str] = set()
        errors: list[str] = []

        for f in local:
            name = str(f.get("name") or "").strip()
            album_ids = f.get("album_ids")
            if not name or not isinstance(album_ids, list) or not album_ids:
                continue

            jm_fid = str(remote_folder_by_name.get(name) or "").strip()
            if not jm_fid and bool(req.create_missing_folders):
                try:
                    jm_fid = _create_remote_folder(name)
                    if jm_fid:
                        remote_folder_by_name[name] = jm_fid
                        created_folders += 1
                except Exception as e:
                    errors.append(f"创建文件夹失败：{name}（{str(e) or 'error'}）")
                    continue

            for aid0 in album_ids:
                aid = str(aid0 or "").strip()
                if not aid:
                    continue
                if aid in processed:
                    duplicates += 1
                    continue

                if aid not in remote_ids:
                    ra = AddAndDelFavoritesReq2(aid)
                    ra.timeout = 10
                    ra.execute()
                    remote_ids.add(aid)
                    added_favorites += 1
                else:
                    skipped += 1

                if jm_fid:
                    rm = MoveFavoritesFoldReq2(aid, jm_fid)
                    rm.timeout = 10
                    rm.execute()
                    moved += 1

                processed.add(aid)

        return ok(
            {
                "created_folders": created_folders,
                "added_favorites": added_favorites,
                "moved": moved,
                "skipped_existing": skipped,
                "duplicates_skipped": duplicates,
                "errors": errors[:10],
            },
            msg="",
        )

    try:
        return _run()
    except Exception as e:
        if "HTTP 401" in str(e) and _relogin_from_saved_config():
            try:
                return _run()
            except Exception:
                return err(Status.NotLogin, "Not logged in")
        if "HTTP 401" in str(e):
            return err(Status.NotLogin, "Not logged in")
        return err(Status.Error, str(e))


@app.get("/api/aura/library/folders")
def aura_library_folders(request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    return ok(aura_list_folders(u), msg="")


@app.post("/api/aura/library/folders/create")
def aura_library_folder_create(req: AuraFolderCreateRequest, request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    try:
        f = aura_create_folder(u, req.name)
        return ok(f, msg="")
    except Exception as e:
        return err(Status.UserError, str(e) or "Create failed")


@app.post("/api/aura/library/folders/rename")
def aura_library_folder_rename(req: AuraFolderRenameRequest, request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    try:
        aura_rename_folder(u, req.folder_id, req.name)
        return ok({"status": "success"}, msg="")
    except Exception as e:
        return err(Status.UserError, str(e) or "Rename failed")


@app.post("/api/aura/library/folders/delete")
def aura_library_folder_delete(req: AuraFolderDeleteRequest, request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    try:
        aura_delete_folder(u, req.folder_id)
        return ok({"status": "success"}, msg="")
    except Exception as e:
        return err(Status.UserError, str(e) or "Delete failed")


@app.post("/api/aura/library/folders/toggle")
def aura_library_folder_toggle(req: AuraFolderToggleItemRequest, request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    try:
        aura_toggle_folder_item(u, req.folder_id, req.album_id, bool(req.present))
        return ok({"status": "success"}, msg="")
    except Exception as e:
        return err(Status.UserError, str(e) or "Update failed")


@app.get("/api/aura/library/notes/{album_id}")
def aura_library_note_get(album_id: str, request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    return ok(aura_get_note(u, album_id), msg="")


@app.post("/api/aura/library/notes/set")
def aura_library_note_set(req: AuraNoteSetRequest, request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    try:
        aura_set_note(u, req.album_id, tags=req.tags, note=str(req.note or ""))
        return ok({"status": "success"}, msg="")
    except Exception as e:
        return err(Status.UserError, str(e) or "Update failed")


class AuraJmAccountAddRequest(BaseModel):
    username: str
    password: str
    set_active: bool | None = True


class AuraJmAccountSwitchRequest(BaseModel):
    username: str


class AuraJmAccountRemoveRequest(BaseModel):
    username: str


class JmWebRegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    password_confirm: str
    gender: str | None = None
    verification: str | None = None


@app.get("/api/jm/register/captcha")
def jm_register_captcha(request: Request):
    site_u = get_site_user(request)
    if not site_u:
        return JSONResponse(err(Status.NotLogin, "Aura login required"), status_code=401)
    base = str(GlobalConfig.Url.value or "").strip()
    if not base:
        return err(Status.Error, "Missing JM web base url")
    s = _get_jm_register_session(site_u)
    try:
        try:
            s.get(f"{base}/login", headers=_jm_web_headers(f"{base}/login"), timeout=8, allow_redirects=True)
        except Exception:
            pass
        r = s.get(f"{base}/captcha", headers=_jm_web_headers(f"{base}/signup"), timeout=12, allow_redirects=True)
        ct = str(r.headers.get("content-type") or "image/jpeg")
        return StreamingResponse(io.BytesIO(r.content), media_type=ct)
    except Exception as e:
        return err(Status.Error, str(e) or "Captcha fetch failed")


@app.post("/api/jm/register")
def jm_register(req: JmWebRegisterRequest, request: Request):
    site_u = get_site_user(request)
    if not site_u:
        return JSONResponse(err(Status.NotLogin, "Aura login required"), status_code=401)
    u = str(req.username or "").strip()
    em = str(req.email or "").strip()
    pw = str(req.password or "")
    pw2 = str(req.password_confirm or "")
    ver = str(req.verification or "").strip()
    gender = str(req.gender or "Male").strip()
    if gender not in ("Male", "Female"):
        gender = "Male"
    if not u or not em or not pw or not pw2:
        return err(Status.UserError, "Missing fields")
    if pw != pw2:
        return err(Status.UserError, "Password not match")

    base = str(GlobalConfig.Url.value or "").strip()
    if not base:
        return err(Status.Error, "Missing JM web base url")

    s = _get_jm_register_session(site_u)
    url = f"{base}/signup"
    data = {
        "username": u,
        "password": pw,
        "email": em,
        "verification": ver,
        "password_confirm": pw2,
        "gender": gender,
        "age": "on",
        "terms": "on",
        "submit_signup": "",
    }
    try:
        headers = _jm_web_headers(url)
        headers["content-type"] = "application/x-www-form-urlencoded"
        r = s.post(url, data=data, headers=headers, timeout=18, allow_redirects=True)
        hist = list(getattr(r, "history", []) or [])
        if hist:
            return ok({"status": "success"}, msg="")
        final_url = str(getattr(r, "url", "") or "")
        if final_url and final_url != url:
            return ok({"status": "success"}, msg="")
        txt = str(getattr(r, "text", "") or "")
        m = re.search(r"<title[^>]*>(.*?)</title>", txt, flags=re.IGNORECASE | re.DOTALL)
        title = (m.group(1).strip() if m else "")[:120]
        if not title:
            title = "Register failed"
        return err(Status.UserError, title)
    except Exception as e:
        return err(Status.Error, str(e) or "Register failed")


@app.get("/api/aura/jm/accounts")
def aura_jm_accounts(request: Request):
    u = get_site_user(request)
    if not u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    data = list_accounts(user=u)
    try:
        accounts = data.get("accounts") if isinstance(data, dict) else None
        if isinstance(accounts, list):
            out = []
            for it in accounts:
                if not isinstance(it, dict):
                    continue
                name = str(it.get("username") or "").strip()
                if not name:
                    continue
                ident = f"{u}#jm#{name}"
                logged_in = False
                try:
                    logged_in = bool(get_session(user=ident).cookies.get_dict())
                except Exception:
                    logged_in = False
                row = dict(it)
                row["logged_in"] = logged_in
                out.append(row)
            data["accounts"] = out
    except Exception:
        pass
    return ok(data, msg="")


@app.post("/api/aura/jm/accounts/add")
def aura_jm_accounts_add(req: AuraJmAccountAddRequest, request: Request):
    aura_u = get_site_user(request)
    if not aura_u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    jm_u = str(req.username or "").strip()
    jm_p = str(req.password or "")
    if not jm_u or not jm_p:
        return err(Status.UserError, "Missing username or password")

    ident = f"{aura_u}#jm#{jm_u}"
    token = current_jm_identity.set(ident)
    try:
        data = LoginReq2(jm_u, jm_p).execute()
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
    except Exception as e:
        return err(Status.UserError, str(e) or "Login failed")
    finally:
        try:
            current_jm_identity.reset(token)
        except Exception:
            pass

    try:
        set_credentials(jm_u, jm_p, user=aura_u)
        if req.set_active is False:
            pass
        else:
            set_active(jm_u, user=aura_u)
    except Exception:
        pass
    return ok({"status": "success"}, msg="")


@app.post("/api/aura/jm/accounts/switch")
def aura_jm_accounts_switch(req: AuraJmAccountSwitchRequest, request: Request):
    aura_u = get_site_user(request)
    if not aura_u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    target = str(req.username or "").strip()
    if not target:
        return err(Status.UserError, "Missing username")
    prev = ""
    try:
        prev = get_username(user=aura_u)
    except Exception:
        prev = ""
    try:
        u2, p2 = get_credentials(user=aura_u, jm_username=target)
        u2 = str(u2 or "").strip()
        p2 = str(p2 or "").strip()
        if not u2 or not p2:
            return err(Status.UserError, "Password not saved for this account")
        set_active(target, user=aura_u)
        ident = f"{aura_u}#jm#{target}"
        token = current_jm_identity.set(ident)
        try:
            data = LoginReq2(u2, p2).execute()
            save_cookies(user=ident)
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
        finally:
            try:
                current_jm_identity.reset(token)
            except Exception:
                pass
    except Exception as e:
        try:
            if prev:
                set_active(prev, user=aura_u)
        except Exception:
            pass
        return err(Status.UserError, str(e) or "Switch failed")


@app.post("/api/aura/jm/accounts/remove")
def aura_jm_accounts_remove(req: AuraJmAccountRemoveRequest, request: Request):
    aura_u = get_site_user(request)
    if not aura_u:
        return JSONResponse(err(Status.NotLogin, "Not authenticated"), status_code=401)
    jm_u = str(req.username or "").strip()
    if not jm_u:
        return err(Status.UserError, "Missing username")
    ident = f"{aura_u}#jm#{jm_u}"
    try:
        clear_cookies(user=ident)
    except Exception:
        pass
    try:
        clear_current_user_data(user=ident)
    except Exception:
        pass
    try:
        remove_account(jm_u, user=aura_u)
    except Exception as e:
        return err(Status.UserError, str(e) or "Remove failed")
    return ok({"status": "success"}, msg="")


class ConfigRequest(BaseModel):
    username: str
    password: str
    save_password: bool | None = None
    auto_login: bool | None = None


class V2AuthRequest(BaseModel):
    username: str
    password: str


class ReloginRequest(BaseModel):
    username: str | None = None
    password: str | None = None


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
async def update_config(config: ConfigRequest, request: Request):
    site_u = get_site_user(request)
    if not site_u:
        raise HTTPException(status_code=401, detail="Aura login required")
    try:
        data = LoginReq2(config.username, config.password).execute()
    except Exception:
        raise HTTPException(status_code=401, detail="Login failed. Please check your username and password.")

    save_cookies()

    want_save = bool(config.save_password) or bool(config.auto_login)
    if want_save:
        try:
            set_credentials(config.username, config.password, user=site_u)
        except Exception:
            pass

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


@app.get("/api/credentials")
def api_get_credentials_meta(request: Request):
    site_u = get_site_user(request)
    if not site_u:
        return {"has_saved": False, "username": "", "st": Status.Ok, "msg": ""}
    u = get_username(user=site_u)
    return {"has_saved": bool(has_credentials(user=site_u)), "username": u, "st": Status.Ok, "msg": ""}


@app.delete("/api/credentials")
def api_clear_credentials(request: Request):
    site_u = get_site_user(request)
    if not site_u:
        return {"status": "success", "st": Status.Ok, "msg": ""}
    try:
        clear_credentials(user=site_u)
    except Exception:
        pass
    return {"status": "success", "st": Status.Ok, "msg": ""}


@app.post("/api/session/relogin")
async def session_relogin(req: ReloginRequest, request: Request):
    site_u0 = get_site_user(request)
    if not site_u0:
        return JSONResponse(err(Status.NotLogin, "Aura login required"), status_code=401)
    u = str(req.username or "").strip()
    p = str(req.password or "").strip()
    if not u or not p:
        u2, p2 = get_credentials(user=site_u0)
        u = str(u2 or "").strip()
        p = str(p2 or "").strip()
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

def _get_saved_jm_credentials() -> tuple[str, str]:
    try:
        u, p = get_credentials()
        return str(u or "").strip(), str(p or "").strip()
    except Exception:
        return "", ""


def _relogin_from_saved_config() -> bool:
    u, p = _get_saved_jm_credentials()
    if not u or not p:
        return False
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
        return True
    except Exception:
        return False


@app.get("/api/config")
async def get_config():
    try:
        u = get_username()
    except Exception:
        u = ""
    try:
        is_logged_in = bool(get_session().cookies.get_dict())
    except Exception:
        is_logged_in = False
    return {"username": u, "is_logged_in": is_logged_in, "st": Status.Ok, "msg": ""}


@app.post("/api/logout")
async def logout():
    clear_cookies()
    set_user_id(None)
    set_user_profile({})
    try:
        jm_service.update_config("", "")
    except Exception:
        pass
    return {"status": "success", "message": "Logged out", "st": Status.Ok, "msg": ""}


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
def v2_login(source: str, req: V2AuthRequest, request: Request):
    if str(source or "").lower() == "jm":
        if not get_site_user(request):
            return JSONResponse(err(Status.NotLogin, "Aura login required"), status_code=401)
    try:
        p = get_provider(source)  # type: ignore[arg-type]
        return _v2_ok(p.login(req.username, req.password))
    except Exception as e:
        return _v2_err(e)


@app.post("/api/v2/{source}/auth/register")
def v2_register(source: str, req: V2RegisterRequest, request: Request):
    if str(source or "").lower() == "jm":
        if not get_site_user(request):
            return JSONResponse(err(Status.NotLogin, "Aura login required"), status_code=401)
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
        now = time.time()
        with _PROMOTE_CACHE_LOCK:
            hit = _PROMOTE_CACHE.get(page)
            if hit and (now - hit[0]) <= _PROMOTE_TTL_SEC:
                return copy.deepcopy(hit[1])
        data = GetIndexInfoReq2(page).execute()
        now = time.time()
        with _PROMOTE_CACHE_LOCK:
            _PROMOTE_CACHE[page] = (now, data)
        return data
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
    def _run() -> dict:
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

    try:
        return _run()
    except Exception as e:
        if "HTTP 401" in str(e) and _relogin_from_saved_config():
            try:
                return _run()
            except Exception:
                return {"content": [], "total": 0, "pages": 1, "folders": [], "st": Status.NotLogin, "msg": "Not logged in"}
        if "HTTP 401" in str(e):
            return {"content": [], "total": 0, "pages": 1, "folders": [], "st": Status.NotLogin, "msg": "Not logged in"}
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/favorites/sync")
def sync_favorites(max_pages: int = 20, folder_id: str = "0"):
    def _run() -> dict:
        ids: list[str] = []
        folders: list[dict] = []
        pages = 1
        page = 1
        safe_max = max(1, min(int(max_pages or 1), 50))
        while page <= safe_max:
            raw = GetFavoritesReq2(page=page, fid=folder_id).execute()
            data = adapt_favorites(raw)
            if page == 1:
                folders = data.get("folders") or []
                pages = int(data.get("pages") or 1)
            content = data.get("content") or []
            if isinstance(content, list):
                for it in content:
                    if isinstance(it, dict):
                        aid = str(it.get("album_id") or "").strip()
                        if aid:
                            ids.append(aid)
            if page >= pages:
                break
            if not content:
                break
            page += 1
        uniq = sorted(set(ids))
        set_favorite_ids(uniq)
        return {"ids": uniq, "folders": folders, "pages": pages, "st": Status.Ok, "msg": ""}

    try:
        return _run()
    except Exception as e:
        if "HTTP 401" in str(e) and _relogin_from_saved_config():
            try:
                return _run()
            except Exception:
                return {"ids": [], "folders": [], "pages": 1, "st": Status.NotLogin, "msg": "Not logged in"}
        if "HTTP 401" in str(e):
            return {"ids": [], "folders": [], "pages": 1, "st": Status.NotLogin, "msg": "Not logged in"}
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/favorite/toggle")
def favorite_toggle(req: FavoriteToggleRequest):
    def _run() -> dict:
        desired = req.desired_state
        current = is_favorite(req.album_id)
        if desired is not None and bool(desired) == bool(current):
            return merge_ok({"result": {"skipped": True}, "is_favorite": bool(current)}, msg="")

        raw = AddAndDelFavoritesReq2(req.album_id).execute()
        st: bool | None = None
        if desired is not None:
            st = bool(desired)
        if isinstance(raw, dict):
            op = str(raw.get("type") or raw.get("action") or raw.get("op") or "").strip().lower()
            if op in ("add", "added", "favorite", "fav", "on", "1", "true"):
                st = True
            elif op in ("del", "delete", "removed", "remove", "unfavorite", "off", "0", "false"):
                st = False
            else:
                v = raw.get("is_favorite")
                if isinstance(v, bool):
                    st = v
        if st is None:
            if desired is not None:
                st = bool(desired)
            else:
                st = not current
        set_favorite(req.album_id, st)
        return merge_ok({"result": raw, "is_favorite": st}, msg="")

    try:
        return _run()
    except Exception as e:
        if "HTTP 401" in str(e) and _relogin_from_saved_config():
            try:
                return _run()
            except Exception:
                return err(Status.NotLogin, "Not logged in")
        if "HTTP 401" in str(e):
            return err(Status.NotLogin, "Not logged in")
        return err(Status.Error, str(e))


@app.post("/api/favorite_folder")
def favorite_folder(req: FavoriteFolderRequest):
    t = (req.type or "").strip().lower()
    def _run() -> dict:
        def _fetch_folders() -> list[dict]:
            r0 = GetFavoritesReq2(page=1, fid="0")
            r0.timeout = 4
            raw0 = r0.execute()
            d0 = adapt_favorites(raw0)
            folders0 = d0.get("folders") or []
            return folders0 if isinstance(folders0, list) else []

        def _find_folder(folders: list[dict], fid: str) -> dict | None:
            fid0 = str(fid or "")
            for f in folders or []:
                if isinstance(f, dict) and str(f.get("id") or "") == fid0:
                    return f
            return None

        if t == "add":
            name = str(req.folder_name or "").strip()
            if not name:
                return err(Status.UserError, "Missing folder_name")
            r_add = AddFavoritesFoldReq2(name)
            r_add.timeout = 6
            raw = r_add.execute()
            folders: list[dict] = []
            last_err = ""
            errors = 0
            for _ in range(4):
                try:
                    folders = _fetch_folders()
                    if any(isinstance(f, dict) and str(f.get("name") or "") == name for f in folders):
                        return merge_ok({"result": raw, "folders": folders}, msg="")
                except Exception as e:
                    if "HTTP 401" in str(e):
                        raise
                    errors += 1
                    last_err = str(e)
                    if errors >= 2:
                        break
                time.sleep(0.3)
            return err(Status.Error, "Folder add not applied", data={"result": raw, "folders": folders, "error": last_err})
        elif t == "del":
            fid = str(req.folder_id or "").strip()
            if not fid or fid == "0":
                return err(Status.UserError, "Invalid folder_id")
            r_del = DelFavoritesFoldReq2(fid)
            r_del.timeout = 6
            raw = r_del.execute()
            folders = []
            last_err = ""
            errors = 0
            for _ in range(4):
                try:
                    folders = _fetch_folders()
                    if not _find_folder(folders, fid):
                        return merge_ok({"result": raw, "folders": folders}, msg="")
                except Exception as e:
                    if "HTTP 401" in str(e):
                        raise
                    errors += 1
                    last_err = str(e)
                    if errors >= 2:
                        break
                time.sleep(0.3)
            return err(Status.Error, "Folder delete not applied", data={"result": raw, "folders": folders, "error": last_err})
        elif t == "rename":
            fid = req.folder_id or ""
            name = req.folder_name or ""
            r_ren = RenameFavoritesFoldReq2(fid, name, rename_type="rename")
            r_ren.timeout = 6
            raw = r_ren.execute()
            if isinstance(raw, dict) and str(raw.get("status") or "").lower() == "fail":
                r_ren2 = RenameFavoritesFoldReq2(fid, name, rename_type="edit")
                r_ren2.timeout = 6
                raw2 = r_ren2.execute()
                if not (isinstance(raw2, dict) and str(raw2.get("status") or "").lower() == "fail"):
                    raw = raw2
            fid0 = str(fid or "").strip()
            name0 = str(name or "").strip()
            folders = []
            last_err = ""
            errors = 0
            for _ in range(4):
                try:
                    folders = _fetch_folders()
                    f = _find_folder(folders, fid0)
                    if f and str(f.get("name") or "") == name0:
                        return merge_ok({"result": raw, "folders": folders}, msg="")
                except Exception as e:
                    if "HTTP 401" in str(e):
                        raise
                    errors += 1
                    last_err = str(e)
                    if errors >= 2:
                        break
                time.sleep(0.3)

            if not fid0 or fid0 == "0" or not name0:
                return err(Status.UserError, "Invalid folder_id or folder_name", data={"result": raw, "folders": folders})

            r_add2 = AddFavoritesFoldReq2(name0)
            r_add2.timeout = 6
            emu_add_raw = r_add2.execute()
            new_fid = ""
            folders2: list[dict] = []
            errors = 0
            last_err2 = ""
            for _ in range(4):
                try:
                    folders2 = _fetch_folders()
                    matches = [f for f in folders2 if isinstance(f, dict) and str(f.get("name") or "") == name0 and str(f.get("id") or "") != fid0]
                    if matches:
                        def _as_int(x: str) -> int:
                            try:
                                return int(str(x or "0"))
                            except Exception:
                                return 0
                        matches.sort(key=lambda x: _as_int(str(x.get("id") or "0")))
                        new_fid = str(matches[-1].get("id") or "")
                        break
                except Exception as e:
                    if "HTTP 401" in str(e):
                        raise
                    errors += 1
                    last_err2 = str(e)
                    if errors >= 2:
                        break
                time.sleep(0.3)
            if not new_fid:
                return err(Status.Error, "Folder rename failed and fallback add not applied", data={"result": raw, "add_result": emu_add_raw, "folders": folders2, "error": (last_err2 or last_err)})

            try:
                r_f1 = GetFavoritesReq2(page=1, fid=fid0)
                r_f1.timeout = 6
                raw_first = r_f1.execute()
                d_first = adapt_favorites(raw_first)
                total = int(d_first.get("total") or 0)
                if total > 200:
                    return err(Status.Error, "Folder too large to migrate automatically", data={"result": raw, "new_folder_id": new_fid, "total": total})

                old_page = 1
                moved = 0
                max_moves = 220
                while moved < max_moves:
                    if old_page == 1:
                        d_f = d_first
                    else:
                        r_fp = GetFavoritesReq2(page=old_page, fid=fid0)
                        r_fp.timeout = 6
                        d_f = adapt_favorites(r_fp.execute())
                    items = d_f.get("content") or []
                    if not isinstance(items, list) or not items:
                        break
                    for it in items:
                        if moved >= max_moves:
                            break
                        if not isinstance(it, dict):
                            continue
                        aid = str(it.get("album_id") or "").strip()
                        if not aid:
                            continue
                        r_mv = MoveFavoritesFoldReq2(aid, new_fid)
                        r_mv.timeout = 6
                        r_mv.execute()
                        moved += 1
                    pages = int(d_f.get("pages") or 1)
                    if old_page >= pages:
                        break
                    old_page += 1

                r_del2 = DelFavoritesFoldReq2(fid0)
                r_del2.timeout = 6
                r_del2.execute()
            except Exception as e:
                return err(Status.Error, "Folder rename fallback move failed", data={"result": raw, "new_folder_id": new_fid, "error": str(e)})

            folders3 = []
            last_err3 = ""
            errors = 0
            for _ in range(6):
                try:
                    folders3 = _fetch_folders()
                    if not _find_folder(folders3, fid0) and _find_folder(folders3, new_fid):
                        return merge_ok({"result": raw, "folders": folders3, "emulated": True, "old_folder_id": fid0, "new_folder_id": new_fid}, msg="")
                except Exception as e:
                    if "HTTP 401" in str(e):
                        raise
                    errors += 1
                    last_err3 = str(e)
                    if errors >= 2:
                        break
                time.sleep(0.3)

            return err(Status.Error, "Folder rename fallback not fully applied", data={"result": raw, "new_folder_id": new_fid, "folders": folders3, "error": last_err3})
        elif t == "move":
            r_mv0 = MoveFavoritesFoldReq2(req.album_id or "", req.folder_id or "")
            r_mv0.timeout = 6
            raw = r_mv0.execute()
            return merge_ok({"result": raw}, msg="")
        else:
            return err(Status.UserError, "Invalid type")

    try:
        return _run()
    except Exception as e:
        if "HTTP 401" in str(e) and _relogin_from_saved_config():
            try:
                return _run()
            except Exception:
                return err(Status.NotLogin, "Not logged in")
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
    ref = "https://jmcomic.me/"
    try:
        pu = urlparse(url)
        if pu.scheme and pu.netloc:
            ref = f"{pu.scheme}://{pu.netloc}/"
    except Exception:
        pass
    headers = {
        "Referer": ref,
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
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

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
            headers = {
                "Referer": f"https://{host}/",
                "User-Agent": ua,
            }
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


project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
frontend_path = os.path.join(project_root, "frontend")


@app.get("/")
async def read_index():
    return FileResponse(os.path.join(frontend_path, "index.html"), headers={"Cache-Control": "no-cache"})


@app.get("/app.js", include_in_schema=False)
async def app_js():
    return FileResponse(os.path.join(frontend_path, "app.js"), headers={"Cache-Control": "public, max-age=86400"})


@app.get("/app-loader.js", include_in_schema=False)
async def app_loader_js():
    return FileResponse(os.path.join(frontend_path, "app-loader.js"), headers={"Cache-Control": "public, max-age=86400"})


@app.get("/app-shell.html", include_in_schema=False)
async def app_shell():
    return FileResponse(os.path.join(frontend_path, "app-shell.html"), headers={"Cache-Control": "public, max-age=300"})


@app.get("/views/{name}", include_in_schema=False)
async def view_file(name: str):
    safe = str(name or "").strip()
    if "/" in safe or "\\" in safe or ".." in safe:
        raise HTTPException(status_code=400, detail="Invalid view name")
    p = os.path.join(frontend_path, "views", safe)
    if not os.path.exists(p):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(p, headers={"Cache-Control": "public, max-age=300"})


_VIEW_BUNDLE_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
_VIEW_BUNDLE_LOCK = threading.Lock()
_APP_BUNDLE_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
_APP_BUNDLE_LOCK = threading.Lock()


@app.get("/views.bundle.json", include_in_schema=False)
async def views_bundle():
    now = time.time()
    with _VIEW_BUNDLE_LOCK:
        if _VIEW_BUNDLE_CACHE.get("data") is not None and now - float(_VIEW_BUNDLE_CACHE.get("ts") or 0.0) <= 300.0:
            return JSONResponse(_VIEW_BUNDLE_CACHE["data"], headers={"Cache-Control": "public, max-age=300"})

    views_dir = os.path.join(frontend_path, "views")
    files = [
        "home.html",
        "search.html",
        "detail.html",
        "config.html",
        "reader.html",
        "jm_latest.html",
        "jm_categories.html",
        "jm_leaderboard.html",
        "jm_random.html",
        "jm_history.html",
        "jm_favorites.html",
    ]
    out: dict[str, str] = {}
    for f in files:
        p = os.path.join(views_dir, f)
        if not os.path.exists(p):
            continue
        try:
            with open(p, "r", encoding="utf-8") as fp:
                out[f] = fp.read()
        except Exception:
            continue

    payload = {"views": out}
    with _VIEW_BUNDLE_LOCK:
        _VIEW_BUNDLE_CACHE["ts"] = now
        _VIEW_BUNDLE_CACHE["data"] = payload
    return JSONResponse(payload, headers={"Cache-Control": "public, max-age=300"})


@app.get("/app.bundle.json", include_in_schema=False)
async def app_bundle():
    now = time.time()
    with _APP_BUNDLE_LOCK:
        if _APP_BUNDLE_CACHE.get("data") is not None and now - float(_APP_BUNDLE_CACHE.get("ts") or 0.0) <= 300.0:
            return JSONResponse(_APP_BUNDLE_CACHE["data"], headers={"Cache-Control": "public, max-age=300"})

    views_dir = os.path.join(frontend_path, "views")
    files = [
        "home.html",
        "search.html",
        "detail.html",
        "config.html",
        "reader.html",
        "jm_latest.html",
        "jm_categories.html",
        "jm_leaderboard.html",
        "jm_random.html",
        "jm_history.html",
        "jm_favorites.html",
    ]

    try:
        with open(os.path.join(frontend_path, "app-shell.html"), "r", encoding="utf-8") as fp:
            shell_html = fp.read()
    except Exception:
        shell_html = ""

    out: dict[str, str] = {}
    for f in files:
        p = os.path.join(views_dir, f)
        if not os.path.exists(p):
            continue
        try:
            with open(p, "r", encoding="utf-8") as fp:
                out[f] = fp.read()
        except Exception:
            continue

    payload = {"shell": shell_html, "views": out}
    with _APP_BUNDLE_LOCK:
        _APP_BUNDLE_CACHE["ts"] = now
        _APP_BUNDLE_CACHE["data"] = payload
    return JSONResponse(payload, headers={"Cache-Control": "public, max-age=300"})


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    root_favicon_path = os.path.join(project_root, "favicon.ico")
    if os.path.exists(root_favicon_path):
        return FileResponse(root_favicon_path, media_type="image/x-icon")

    frontend_favicon_path = os.path.join(frontend_path, "favicon.ico")
    if os.path.exists(frontend_favicon_path):
        return FileResponse(frontend_favicon_path, media_type="image/x-icon")

    raise HTTPException(status_code=404, detail="Not found")


app.mount("/", StaticFiles(directory=frontend_path), name="static")


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("JM_AURA_HOST") or "0.0.0.0"
    port = int(os.environ.get("JM_AURA_PORT") or "8000")
    uvicorn.run(app, host=host, port=port)
