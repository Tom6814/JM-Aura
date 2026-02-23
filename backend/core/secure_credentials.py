from __future__ import annotations

import base64
import json
import os
import sys
from typing import Any

from backend.core.paths import app_data_dir
from backend.core.site_auth import current_site_user


def _store_path() -> str:
    if os.environ.get("JM_AURA_CREDENTIALS_PATH"):
        return os.environ["JM_AURA_CREDENTIALS_PATH"]
    if getattr(sys, "frozen", False):
        return os.path.join(app_data_dir(), "credentials.json")
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_dir, "backend", "config", "credentials.json")


def _load_raw() -> dict[str, Any]:
    p = _store_path()
    if not os.path.exists(p):
        return {"v": 2, "users": {}}
    try:
        with open(p, "r", encoding="utf-8") as f:
            v = json.load(f)
        if not isinstance(v, dict):
            return {"v": 2, "users": {}}
        if "users" not in v or not isinstance(v.get("users"), dict):
            v["users"] = {}
        if v.get("v") != 2:
            v = _migrate_to_v2(v)
        return v
    except Exception:
        return {"v": 2, "users": {}}


def _save_raw(data: dict[str, Any]) -> None:
    p = _store_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _site_user(user: str | None = None) -> str:
    u = str(user or "").strip()
    if not u:
        u = str(current_site_user.get() or "").strip()
    return u or "anon"


def _bucket(data: dict[str, Any], user: str | None = None) -> dict[str, Any]:
    users = data.get("users")
    if not isinstance(users, dict):
        users = {}
        data["users"] = users
    k = _site_user(user)
    b = users.get(k)
    if not isinstance(b, dict):
        b = {}
        users[k] = b
    return b


def _migrate_to_v2(raw: dict[str, Any]) -> dict[str, Any]:
    users = raw.get("users")
    if not isinstance(users, dict):
        users = {}
    out_users: dict[str, Any] = {}
    for k, v in users.items():
        if not isinstance(k, str):
            continue
        if not isinstance(v, dict):
            continue
        b: dict[str, Any] = {}
        accounts: dict[str, Any] = {}
        legacy_u = str(v.get("jm_username") or "").strip()
        if legacy_u:
            acc = {}
            for fld in ("password_dpapi_b64", "password_keyring", "password_plain"):
                if fld in v:
                    acc[fld] = v.get(fld)
            accounts[legacy_u] = acc
            b["active"] = legacy_u
        b["accounts"] = accounts
        out_users[k] = b
    return {"v": 2, "users": out_users}


def _accounts_bucket(b: dict[str, Any]) -> tuple[dict[str, Any], str]:
    acc = b.get("accounts")
    if not isinstance(acc, dict):
        acc = {}
        b["accounts"] = acc
    active = str(b.get("active") or "").strip()
    return acc, active


def list_accounts(*, user: str | None = None) -> dict[str, Any]:
    raw = _load_raw()
    b = _bucket(raw, user=user)
    acc, active = _accounts_bucket(b)
    out = []
    for k in sorted(acc.keys()):
        u = str(k or "").strip()
        if not u:
            continue
        rec = acc.get(u)
        has_pw = False
        if isinstance(rec, dict):
            if sys.platform.startswith("win"):
                has_pw = bool(str(rec.get("password_dpapi_b64") or "").strip())
            else:
                has_pw = bool(rec.get("password_keyring") is True)
        out.append({"username": u, "active": (u == active), "has_password": has_pw})
    return {"active": active, "accounts": out}


def set_active(username: str, *, user: str | None = None) -> None:
    u = str(username or "").strip()
    if not u:
        raise ValueError("Missing username")
    raw = _load_raw()
    b = _bucket(raw, user=user)
    acc, _ = _accounts_bucket(b)
    if u not in acc:
        raise ValueError("Account not found")
    b["active"] = u
    _save_raw(raw)


def remove_account(username: str, *, user: str | None = None) -> None:
    u = str(username or "").strip()
    if not u:
        raise ValueError("Missing username")
    raw = _load_raw()
    b = _bucket(raw, user=user)
    acc, active = _accounts_bucket(b)
    rec = acc.get(u)
    if isinstance(rec, dict):
        if rec.get("password_keyring") is True and not sys.platform.startswith("win"):
            try:
                import keyring  # type: ignore
                try:
                    site_u = _site_user(user)
                    keyring.delete_password("JM-Aura", f"{site_u}:{u}")
                except Exception:
                    pass
            except Exception:
                pass
    acc.pop(u, None)
    if active == u:
        b["active"] = next(iter(sorted(acc.keys())), "")
    _save_raw(raw)


def _dpapi_encrypt(plain: bytes) -> bytes:
    import ctypes
    import ctypes.wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", ctypes.wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    in_blob = DATA_BLOB(len(plain), ctypes.cast(ctypes.create_string_buffer(plain), ctypes.POINTER(ctypes.c_byte)))
    out_blob = DATA_BLOB()
    if not crypt32.CryptProtectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise OSError("CryptProtectData failed")
    try:
        out = ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)
    return out


def _dpapi_decrypt(cipher: bytes) -> bytes:
    import ctypes
    import ctypes.wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", ctypes.wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    in_blob = DATA_BLOB(len(cipher), ctypes.cast(ctypes.create_string_buffer(cipher), ctypes.POINTER(ctypes.c_byte)))
    out_blob = DATA_BLOB()
    if not crypt32.CryptUnprotectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise OSError("CryptUnprotectData failed")
    try:
        out = ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)
    return out


def set_credentials(jm_username: str, jm_password: str, *, user: str | None = None) -> None:
    u = str(jm_username or "").strip()
    p = str(jm_password or "")
    if not u or not p:
        raise ValueError("Missing username or password")

    raw = _load_raw()
    raw["v"] = 2
    b = _bucket(raw, user=user)
    acc, _ = _accounts_bucket(b)
    rec = acc.get(u)
    if not isinstance(rec, dict):
        rec = {}
        acc[u] = rec

    if sys.platform.startswith("win"):
        enc = _dpapi_encrypt(p.encode("utf-8"))
        rec["password_dpapi_b64"] = base64.b64encode(enc).decode("ascii")
        rec.pop("password_plain", None)
        rec.pop("password_keyring", None)
    else:
        try:
            import keyring  # type: ignore
        except Exception:
            raise RuntimeError("Secure credential store not available on this platform")
        site_u = _site_user(user)
        keyring.set_password("JM-Aura", f"{site_u}:{u}", p)
        rec["password_keyring"] = True
        rec.pop("password_plain", None)
        rec.pop("password_dpapi_b64", None)

    b["active"] = u

    _save_raw(raw)


def clear_credentials(*, user: str | None = None) -> None:
    raw = _load_raw()
    b = _bucket(raw, user=user)
    acc, _ = _accounts_bucket(b)
    if not sys.platform.startswith("win"):
        try:
            import keyring  # type: ignore
            site_u = _site_user(user)
            for k, rec in list(acc.items()):
                if isinstance(rec, dict) and rec.get("password_keyring") is True:
                    try:
                        keyring.delete_password("JM-Aura", f"{site_u}:{k}")
                    except Exception:
                        pass
        except Exception:
            pass
    b["accounts"] = {}
    b["active"] = ""
    _save_raw(raw)


def get_username(*, user: str | None = None) -> str:
    raw = _load_raw()
    b = _bucket(raw, user=user)
    _, active = _accounts_bucket(b)
    return active


def has_credentials(*, user: str | None = None) -> bool:
    raw = _load_raw()
    b = _bucket(raw, user=user)
    acc, active = _accounts_bucket(b)
    if not acc:
        return False
    u = active or next(iter(acc.keys()), "")
    if not u:
        return False
    rec = acc.get(u)
    if not isinstance(rec, dict):
        return False
    if sys.platform.startswith("win"):
        return bool(str(rec.get("password_dpapi_b64") or "").strip())
    return bool(rec.get("password_keyring") is True)


def get_credentials(*, user: str | None = None, jm_username: str | None = None) -> tuple[str, str]:
    raw = _load_raw()
    b = _bucket(raw, user=user)
    acc, active = _accounts_bucket(b)
    want = str(jm_username or "").strip()
    u = want or active
    if not u:
        u = next(iter(acc.keys()), "")
    if not u:
        return "", ""
    rec = acc.get(u)
    if not isinstance(rec, dict):
        return "", ""
    if sys.platform.startswith("win"):
        b64 = str(rec.get("password_dpapi_b64") or "").strip()
        if not b64:
            return "", ""
        try:
            enc = base64.b64decode(b64.encode("ascii"), validate=True)
            plain = _dpapi_decrypt(enc).decode("utf-8")
            return u, plain
        except Exception:
            return "", ""
    try:
        import keyring  # type: ignore
    except Exception:
        return "", ""
    try:
        site_u = _site_user(user)
        pw = keyring.get_password("JM-Aura", f"{site_u}:{u}") or ""
        return u, str(pw)
    except Exception:
        return "", ""
