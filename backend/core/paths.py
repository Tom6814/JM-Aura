import os
import sys


def app_data_dir(app_name: str = "JM-Aura") -> str:
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, app_name)
    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        return os.path.join(xdg, app_name)
    return os.path.join(os.path.expanduser("~/.local/share"), app_name)


def default_config_path() -> str:
    if getattr(sys, "frozen", False):
        return os.path.join(app_data_dir(), "op.yml")
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_dir, "config", "op.yml")


def default_cookie_path() -> str:
    if getattr(sys, "frozen", False):
        return os.path.join(app_data_dir(), "cookies.json")
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "cookies.json")


def default_download_dir(config_path: str) -> str:
    if getattr(sys, "frozen", False):
        return os.path.join(app_data_dir(), "downloads")
    return os.path.join(os.path.dirname(config_path), "..", "downloads")
