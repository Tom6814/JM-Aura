import requests
from requests.utils import cookiejar_from_dict, dict_from_cookiejar
import json
import os


_session = requests.Session()
_adapter = requests.adapters.HTTPAdapter(pool_connections=50, pool_maxsize=50)
_session.mount("http://", _adapter)
_session.mount("https://", _adapter)

_cookie_file_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "cookies.json")


def get_session() -> requests.Session:
    return _session


def load_cookies() -> None:
    if not os.path.exists(_cookie_file_path):
        return
    try:
        with open(_cookie_file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            _session.cookies = cookiejar_from_dict(data)
    except Exception:
        return


def save_cookies() -> None:
    try:
        os.makedirs(os.path.dirname(_cookie_file_path), exist_ok=True)
        data = dict_from_cookiejar(_session.cookies)
        with open(_cookie_file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        return


def clear_cookies() -> None:
    _session.cookies.clear()
    try:
        if os.path.exists(_cookie_file_path):
            os.remove(_cookie_file_path)
    except Exception:
        return


load_cookies()
