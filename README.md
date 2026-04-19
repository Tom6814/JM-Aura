<div align="center">
  <img src="https://2z2.org/upload/jm-aura5.png" alt="JM-Aura" width="230" height="230" />

  <h1><i>JM-Aura</i></h1>
  <p><i>一个简洁、优雅的 JMComic 漫画阅读/下载 Web 应用</i></p>

  [![GitHub](https://img.shields.io/badge/-GitHub-181717?logo=github)](https://github.com/Tom6814)
  [![GitHub license](https://img.shields.io/github/license/Tom6814/JM-Aura)](https://github.com/Tom6814/JM-Aura/blob/master/LICENSE)
  [![Python Version](https://img.shields.io/badge/python-3.10+-blue?logo=python)](https://www.python.org/)
</div>

---

# 这是什么？

**JM-Aura** 是一个面向 **JMComic** 的本地/自建 Web 应用：  
你只需要启动一次后端服务，然后用浏览器打开 `<服务器IP>:8000`（默认），就能完成 **搜索、浏览、收藏、历史、阅读、批量下载与打包 JMComic 漫画** 等操作。

项目结构很简单：
- 后端：FastAPI（同时负责 API 与静态前端资源分发）
- 前端：Vue3（CDN，无需构建）
- 站点图标：在项目根目录放置 `favicon.ico`，会自动作为浏览器标签图标


## 它能干嘛？实现了 JMComic 的哪些功能？

- **浏览与搜索**：按关键词搜索标题/作者/标签；按分类/排行/最新浏览。
- **沉浸阅读**：长条漫垂直滚动；阅读器模式自动隐藏顶/底栏，减少干扰。
- **继续阅读**：支持记住上次阅读到的章节与页码；登录后会优先从影子账号历史中恢复，不只依赖本地缓存。
- **收藏与历史**：收藏页、历史页独立入口；本地历史与影子账号历史并存。
- **下载与打包**：支持选择章节下载；后台任务进度展示；完成后可直接下载 ZIP。
- **网络与线路**：内置图片代理/多线路机制（遇到加载问题可以切换）。
- **账号体系**：JM 登录/注册直接内置到设置页；登录成功后会自动创建本地影子账号并保存会话。

## 当前架构

- 后端：FastAPI，负责 API、静态资源分发、JM 请求代理、下载任务。
- 前端：Vue 3（CDN 直出，无需单独构建）。
- 数据层：SQLAlchemy。
- 本地状态存储：除了数据库外，还会使用多个 JSON 文件保存 Cookie、凭据、影子账号资料、Aura 历史等运行态数据。

> 注意：
> 本项目不是“只有一个数据库文件”那么简单。
> 目前是 **数据库 + 若干 JSON 运行态文件** 的混合存储结构。


## 🚀 服务器部署（推荐）

适合想要 **24 小时挂机下载/远程阅读** 的用户。以下以 Ubuntu/Debian 为例（其它 Linux 发行版可能略有不同）。

### 1) 准备环境

- 一台 Linux 服务器 **（确保能正常访问外网）**
- Python 3.10+（推荐 3.11+）

### 2) 上传/放置代码

把代码放到服务器某个目录（例如 `/opt/jm-aura`）

方式任选：

- 方式一：`git clone https://github.com/Tom6814/JM-Aura.git <运行项目的目录>`（推荐）
- 方式二：上传你打包好的 zip 并解压到运行项目的目录

### 3) 安装依赖

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip

cd <运行项目的目录>
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

依赖中已包含：
- `SQLAlchemy`
- `PyMySQL`
- `python-dotenv`

如果你使用 SQLite，默认不需要再装额外数据库服务。

### 4) 配置数据库（必做）

后端启动时强依赖环境变量 `DATABASE_URL`；如果不配置，服务会直接报错退出。

代码位置：
- [database.py](file:///c:/Users/tom68/Desktop/132123/backend/core/db/database.py)

最简单的做法是在项目根目录创建 `.env` 文件：

```env
DATABASE_URL=sqlite:///./app.db
JM_AURA_HOST=0.0.0.0
JM_AURA_PORT=8000
```

推荐数据库配置示例：

1. SQLite：适合单机、自用、最省事

```env
DATABASE_URL=sqlite:///./app.db
```

2. MySQL：适合长期部署或多人使用

```env
DATABASE_URL=mysql+pymysql://用户名:密码@127.0.0.1:3306/jm_aura?charset=utf8mb4
```

3. PostgreSQL：如果你更习惯 PG

```env
DATABASE_URL=postgresql+psycopg://用户名:密码@127.0.0.1:5432/jm_aura
```

说明：
- 当前 `requirements.txt` 已内置 `PyMySQL`，所以 **MySQL 可以直接用**。
- 如果你要用 PostgreSQL，需要你自己额外安装 PG 驱动，例如 `psycopg`。
- 程序启动时会自动执行建表逻辑，不需要手动跑 migration。

### 5) 配置 JM 运行参数（推荐）

项目默认会读取：
- `config/op.yml`

仓库里提供了示例文件：
- [op.example.yml](file:///c:/Users/tom68/Desktop/132123/config/op.example.yml)

建议先复制一份：

```bash
cp config/op.example.yml config/op.yml
```

最小示例：

```yml
client:
  domain: []
  postman:
    type: requests
    headers:
      User-Agent: Mozilla/5.0
download:
  image:
    decode: true
```

### 6) 启动（前台）

```bash
cd <运行项目的目录>
export DATABASE_URL=sqlite:///./app.db
JM_AURA_HOST=0.0.0.0 JM_AURA_PORT=8000 ./.venv/bin/python -m backend.main
```

浏览器访问：
- `http://<你的服务器IP>:8000`

### 7) 后台运行（systemd，推荐）

创建服务文件：

```bash
sudo nano /etc/systemd/system/jm-aura.service
```

填入（注意修改路径为你的实际目录）：

```ini
[Unit]
Description=JM-Aura Web
After=network.target

[Service]
Type=simple
WorkingDirectory=<运行项目的目录>
Environment="DATABASE_URL=sqlite:///./app.db"
Environment="JM_AURA_HOST=0.0.0.0"
Environment="JM_AURA_PORT=8000"
ExecStart=<运行项目的目录>/.venv/bin/python -m backend.main
Restart=always

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jm-aura
```

查看状态/日志：

```bash
sudo systemctl status jm-aura
journalctl -u jm-aura -f
```

## 🍽️ 食用方法（怎么用）

### 登录 / 线路

- 打开页面后进入 **设置（Config）**。
- 设置页内可直接进行 **JM 登录 / JM 注册**。
- 登录成功后，系统会自动创建一个本地影子账号，用来保存：
  - 会话
  - 设置
  - Aura 历史
  - 继续阅读页码
- 如遇到图片加载异常/线路问题，在设置里切换线路或重试（项目会记录可用线路）。

### 继续阅读

- 如果未登录，只会记录到当前设备本地缓存。
- 如果已登录影子账号，继续阅读会优先从影子账号历史恢复：
  - 上次阅读章节
  - 上次阅读页码
- 当前阅读器已做过一轮优化：
  - 恢复到上次页时，不会再把前面所有页先完整渲染出来
  - 会优先渲染目标页附近的窗口，减轻长章节恢复时的压力

### 顶栏操作（电脑端）

- 顶栏会根据窗口宽度自动适配：
  - **优先压缩搜索框**，不够再把搜索框变为按钮（点击弹出输入框）
  - 再不够才隐藏按钮文字（只留图标）
  - 最后把非关键按钮收进“菜单”
- 顶栏按钮文字不会换行（避免难看抖动）。

### 阅读器模式

- 打开章节后进入阅读器：
  - 顶栏/底栏会自动隐藏（沉浸阅读）
  - 返回详情或其他页面后恢复正常导航

## ⚙️ 配置与文件（重要）

以下文件可能包含敏感信息，请不要上传/分享：
- `config/op.yml`：运行时线路/配置
- `backend/config/cookies.json` 或 `backend/config/cookies/<user>.json`：登录 Cookie
- `backend/config/credentials.json`：JM 凭据
- `backend/config/site_users.json`：影子账号用户信息
- `backend/config/site_sessions.json`：影子账号会话
- `backend/config/site_profiles.json`：设置页资料与偏好
- `backend/config/aura_library.json`：Aura 历史 / 收藏夹 / 备注
- `backend/config/jm.json`：JM 状态缓存

建议做法：
- 分享代码时只保留 `config/op.example.yml`、`backend/config/cookies.example.json`
- `downloads/` 是下载产物目录（可自行清理/迁移）
- 生产环境请把上述 JSON 文件目录加入备份范围

### 默认路径

- 开发态配置文件：`config/op.yml`
- 开发态下载目录：`downloads/`
- 开发态数据库（若使用 SQLite）：项目根目录下的 `app.db`
- Windows 打包态运行数据：通常落在 `%APPDATA%/JM-Aura/`

### 常用环境变量

- `DATABASE_URL`：数据库连接串，必填
- `JM_AURA_HOST`：监听地址
- `JM_AURA_PORT`：监听端口
- `JM_AURA_CONFIG_PATH`：自定义 `op.yml` 路径
- `JM_AURA_DOWNLOAD_DIR`：自定义下载目录
- `JM_AURA_COOKIE_PATH`：自定义 Cookie 存储位置
- `JM_AURA_CREDENTIALS_PATH`：自定义凭据文件位置
- `JM_AURA_SITE_USERS_PATH`：自定义影子账号用户文件
- `JM_AURA_SITE_SESSIONS_PATH`：自定义影子账号会话文件
- `JM_AURA_SITE_PROFILE_PATH`：自定义设置资料文件
- `JM_AURA_AURA_LIBRARY_PATH`：自定义 Aura 历史/收藏文件
- `JM_AURA_JM_STORE_PATH`：自定义 JM 状态缓存文件

## 🛠️ 常见问题

**Q: 页面能打开，但图片不显示/加载慢？**  
- 先多刷新几次试试，确认图片能正常加载；***确保服务器能正常访问外网***；必要时更换 DNS/代理环境。

**Q: 评论发不出去？**  
- 上游有风控，请避免过短/重复内容，稍等再发。

**Q: 如何更新？**  
- 覆盖更新代码后，执行一次依赖更新并重启即可：

```bash
pip install -r requirements.txt
python -m backend.main
```

**Q: 只配数据库就够了吗？**  
- 不够。数据库主要用于 SQLAlchemy 模型数据；Cookie、会话、影子账号资料、Aura 历史等目前仍然保存在 `backend/config/*.json` 中。

**Q: 推荐怎么配数据库？**  
- 单机自用：`sqlite:///./app.db`
- 长期部署：MySQL
- 如果你没有特殊需求，先用 SQLite 最简单。

## ⚠️ 免责声明

本项目仅供学习交流使用。使用者应遵守当地法律法规及目标网站使用条款；开发者不对使用本项目产生的任何后果负责。
