 <div align="center">
  <img src="https://2z2.org/upload/jm-aura5.png/" alt="JM-Aura" width="200" height="200" />

 <h1><i>JM-Aura</i></h1>
  <p><i>一个简洁、优雅的 JMComic 浏览/阅读/下载网站应用</i></p>

  [![GitHub](https://img.shields.io/badge/-GitHub-181717?logo=github)](https://github.com/Tom6814)
  [![GitHub license](https://img.shields.io/github/license/Tom6814/JM-Aura)](https://github.com/Tom6814/JM-Aura/blob/master/LICENSE)
  [![Python Version](https://img.shields.io/badge/python-3.12-blue?logo=python)](https://www.python.org/)
</div>

---

# 项目简介

JM-Aura (Web)一个基于 **FastAPI + 静态前端 (Vue3 CDN)** 的 JMComic 浏览/阅读/下载工具。项目提供本地 Web UI（搜索、收藏、阅读器、评论、选话下载打包等，material主题），后端负责登录会话、接口转发、图片代理与下载打包。


## 功能特性

- **搜索与详情**：按标题/作者/ID 搜索，查看漫画详情与章节列表。
- **阅读器**：按章节阅读，支持基础显示设置（宽度/间距）与阅读进度记录。
- **收藏夹**：同步收藏/收藏夹分组，支持添加/移动等操作。
- **评论区**：查看评论、回复楼中楼展示、发送评论；点赞按钮提供可用的本地记录（并尝试调用上游接口）。
- **下载与打包**
  - **选话下载（任务制）**：选择若干章节下载 → 自动打包 zip → 自动清理未打包图片目录以节省硬盘。
  - **整本临时 zip**：后端下载到临时目录打包后直接返回 zip（响应后自动删除临时 zip）。
  - **后台队列下载**：后台下载到 `downloads/`，并在 `downloads/zips/` 生成 zip 后清理原始目录。
- **主题**：自带浅色/深色与三种主题色（禁漫橙、哔咔粉、EH绿）切换；全局字体使用 Google Fonts `Outfit`。
- **性能优化**：页面视图拆分为多个 HTML 分片并行加载，配合 `v-cloak` 防止模板闪烁；加载器默认使用强缓存。

## 技术栈

- 后端：Python、FastAPI、Uvicorn、requests、jmcomic、Pillow、PyYAML
- 前端：静态 HTML + Vue3 CDN + Tailwind CDN（无构建步骤）

依赖列表见 [requirements.txt](file:///c:/Users/tom68/Desktop/132123/requirements.txt)。

## Linux 服务器部署

以常见的 Ubuntu/Debian 为例：

> 安全提示：`config/op.yml` 与 `backend/config/cookies.json` 属于敏感信息文件（账号/会话），不要分享或提交到公开仓库。

### 1) 安装系统依赖

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git
```

### 2) 创建目录并安装项目依赖

推荐用独立目录，例如 `/opt/jm-aura`：

```bash
sudo mkdir -p /opt/jm-aura
sudo chown -R $USER:$USER /opt/jm-aura
cd /opt/jm-aura

# 放置项目代码（两种方式任选其一）
# 方式 A：git clone
# git clone <your_repo_url> .
#
# 方式 B：直接把项目文件上传到 /opt/jm-aura

python3 -m venv .venv
.venv/bin/python -m pip install -U pip
.venv/bin/python -m pip install -r requirements.txt
```

### 3) 初始化配置与目录权限

首次运行前建议先准备配置文件（也可以启动后在网页 Settings 里填账号密码自动生成）：

```bash
mkdir -p config backend/config downloads

test -f config/op.yml || cp config/op.example.yml config/op.yml
test -f backend/config/cookies.json || cp backend/config/cookies.example.json backend/config/cookies.json

chmod 600 config/op.yml backend/config/cookies.json
```

### 4) systemd 常驻运行（推荐）

创建服务文件：

```bash
sudo tee /etc/systemd/system/jm-aura.service >/dev/null <<'EOF'
[Unit]
Description=JM-Aura Web (FastAPI)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/jm-aura
ExecStart=/opt/jm-aura/.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
```

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jm-aura
sudo systemctl status jm-aura --no-pager
```

查看日志：

```bash
sudo journalctl -u jm-aura -f
```

此时可直接访问：

- `http://<服务器IP>:8000/`

### 5) Nginx 反代（可选，推荐用于域名/HTTPS）

```bash
sudo apt install -y nginx
```

创建站点配置（示例以域名 `jm.example.com` 为例）：

```bash
sudo tee /etc/nginx/sites-available/jm-aura >/dev/null <<'EOF'
server {
  listen 80;
  server_name jm.example.com;

  client_max_body_size 50m;

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
sudo ln -sf /etc/nginx/sites-available/jm-aura /etc/nginx/sites-enabled/jm-aura
sudo nginx -t
sudo systemctl reload nginx
```

如果需要 HTTPS，可再配合 `certbot`（Let’s Encrypt）签发证书；此处不强制绑定具体方案。

### 6) 更新与重启

更新代码/依赖后，通常流程是：

```bash
cd /opt/jm-aura
# git pull
.venv/bin/python -m pip install -r requirements.txt
sudo systemctl restart jm-aura
```

## 下载说明

### 选话下载（推荐）

漫画详情页右侧的方形按钮用于进入“选话下载”模式：

1. 点击进入选话模式（单话漫画会自动选中该话）
2. 在章节列表中选择要下载的章节
3. 点击“下载 N”创建任务
4. 弹窗显示下载/打包进度，完成后点“打开下载”获取 zip

该模式会在 zip 生成后自动删除未打包的图片目录以节省硬盘空间，但不会删除打包好的 zip 文件。

### 后台队列下载（推荐）

后端提供 `POST /api/download` 进入下载队列。完成后会在 `downloads/zips/` 输出 zip，并清理原始下载文件夹。

### 整本临时 zip（不推荐，已弃用）

后端提供 `GET /api/download_zip?album_id=...`，会将内容下载到临时目录并打包返回，响应结束后自动清理临时 zip。


## 目录结构（关键）

```text
.
├─ backend/                 # FastAPI 后端与 JMComic 请求封装
├─ frontend/                # 静态前端
│  ├─ index.html            # 入口页（加载 Vue/Tailwind CDN + app-loader）
│  ├─ app-loader.js         # 加载器（强缓存 + 并行加载分片）
│  ├─ app.js                # Vue 应用逻辑
│  ├─ app-shell.html        # 轻量“壳”（导航/弹窗 + 视图占位）
│  └─ views/                # 视图分片（home/detail/search/...）
├─ config/
│  ├─ op.yml                # 运行时生成/使用（敏感）
│  └─ op.example.yml        # 示例模板（可分享）
└─  downloads/               # 下载输出目录（任务/队列/zip）
```

## 接口一览（常用）

- `GET /api/search?q=&page=`：搜索
- `GET /api/album/{album_id}`：详情
- `GET /api/chapter/{photo_id}`：章节信息
- `GET /api/chapter_image/{photo_id}/{image_name}`：图片代理/轮询拉取
- `GET /api/comments` / `POST /api/comment`：评论列表/发评论
- `POST /api/download/tasks` / `GET /api/download/tasks/{id}` / `GET /api/download/tasks/{id}/download`：选话下载任务

## 常见使用问题

### 1) 页面更新后看起来还是旧版本？

加载器默认使用强缓存。开发/频繁改动时可：

- 浏览器 **Ctrl + F5** 强制刷新
- 或临时在浏览器关闭缓存（DevTools Network -> Disable cache）

### 2) 评论提示“勿重复留言”但我没重复？

上游可能会把“内容太短/太模板化”的评论误判为重复。建议：

- 尽量写更具体的中文内容（更长一些）
- 避免过短的模板词（如“好看”“哈哈”）

## 免责声明

本项目仅用于学习与本地管理个人内容。请遵守当地法律法规与目标站点的条款。

## 鸣谢

本项目在实现过程中参考/借鉴了以下开源仓库，在此表示感谢：

- https://github.com/tonquer/JMComic-qt
- https://github.com/hect0x7/JMComic-Crawler-Python
