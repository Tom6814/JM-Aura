"""
JM-Aura Windows 可执行文件入口（独立窗口版）。

目标：
- 打包成单独窗口应用（不是打开系统浏览器）
- 即开即用，关闭窗口后自动关闭后台服务，不占用端口/进程
"""

from __future__ import annotations

import os
import sys
import socket
import threading
import time

from backend.core.paths import app_data_dir

# 0) 确保独立运行环境中有合理的数据库路径，避免无 .env 时报错崩溃
if not os.environ.get("DATABASE_URL"):
    db_dir = app_data_dir("JM-Aura")
    os.makedirs(db_dir, exist_ok=True)
    # SQLAlchemy sqlite 绝对路径格式：sqlite:////绝对路径（注意有斜杠处理）
    db_path = os.path.join(db_dir, "jm_aura.db").replace('\\', '/')
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

# 引入 FastAPI app（必须在设置完环境变量后）
from backend.main import app  # noqa: WPS433 (runtime import for packaging)

import uvicorn
import webview

# 默认参数（可用环境变量覆盖）
HOST = os.environ.get("JM_AURA_HOST") or "127.0.0.1"
PORT = int(os.environ.get("JM_AURA_PORT") or "8000")


def _wait_port(host: str, port: int, timeout_sec: float = 15.0) -> bool:
    start = time.time()
    while time.time() - start < timeout_sec:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        try:
            s.connect((host, port))
            s.close()
            return True
        except OSError:
            time.sleep(0.2)
        finally:
            try:
                s.close()
            except Exception:
                pass
    return False


def main():
    # 1) 后台启动 uvicorn（线程方式，便于窗口关闭后发出退出信号）
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="info")
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    ok = _wait_port(HOST, PORT, timeout_sec=20.0)
    url = f"http://{HOST}:{PORT}" if ok else "about:blank"

    # 2) 创建独立窗口承载 Web UI；窗口关闭时自动停止后台服务
    window = webview.create_window("JM-Aura", url=url, width=1200, height=800)

    def _on_closed(*_args, **_kwargs):
        server.should_exit = True

    window.events.closed += _on_closed

    webview.start()

    # 3) 确保退出（释放端口/后台占用）
    server.should_exit = True
    server_thread.join(timeout=5)


if __name__ == "__main__":
    main()
