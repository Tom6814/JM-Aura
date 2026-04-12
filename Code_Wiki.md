# JM-Aura - Code Wiki

## 1. 项目整体架构 (Overall Architecture)

JM-Aura 是一个基于 **FastAPI (后端)** 和 **Vue 3 (前端)** 开发的优雅简洁的 JMComic/禁漫天堂 第三方 Web 客户端。它采用了前后端分离但由后端一并提供静态资源分发的架构。项目本身不需要前端构建（如 Webpack/Vite），直接通过 CDN 和普通 HTML/JS 文件进行挂载和渲染。

### 1.1 架构分层
- **后端服务层 (Backend - Python/FastAPI)**：
  - **API 层**：处理用户的 RESTful 请求，包括搜索、获取漫画详情、阅读章节、用户登录/认证、历史记录和收藏管理。
  - **服务/业务层**：封装第三方 `jmcomic` 库的操作，将复杂的爬虫/解析逻辑抽象为服务。
  - **数据适配层**：将来自源站或爬虫库的不规则数据结构统一格式化为应用前端所期望的标准 JSON 数据。
  - **持久化层**：支持基于 JSON/YAML 文件的本地存储以及通过 SQLAlchemy 的外部数据库存储，用于保存用户凭证、收藏状态和后台下载任务信息。
  - **后台任务管理器**：基于多线程的漫画后台下载队列，允许并发下载并将漫画打包成 ZIP。
- **前端视图层 (Frontend - Vue 3/HTML/JS)**：
  - **视图模板**：分散在 `views/` 目录中的各个 HTML 片段，由 Vue 进行动态加载渲染。
  - **逻辑组件**：统一封装在 `app.js` 内。特别是核心组件 `DescrambledImage`，专门用于在浏览器端解密源站返回的乱序切割图片（防盗链机制）。

---

## 2. 主要模块职责 (Main Module Responsibilities)

### 2.1 后端模块 (`backend/`)
- `main.py`: FastAPI 的核心入口文件，定义了所有的路由（Endpoints）、生命周期钩子、全局异常处理和中间件（如身份验证、GZip 压缩）。
- `jm_service.py`: 核心业务模块。封装了针对 `jmcomic` 库的调用逻辑，包括选项配置（Option）、客户端（Client）构建、漫画搜索、详情获取和文件下载与打包压缩。
- `download_task_manager.py`: 管理后台漫画下载队列的任务管理器模块，控制并发数，跟踪下载进度和状态。
- `core/`: 核心业务逻辑和上下文组件。
  - `api_adapter.py`: 数据适配器。将源站返回的复杂/不一致的数据结构映射转换为前端易于处理的标准化 JSON 模型。
  - `site_auth.py` / `secure_credentials.py`: 处理站点自身的管理员/多用户认证体系，以及代理保存 JMComic 源站的账号密码。
  - `http_session.py`: 管理全局 HTTP Session 及源站 Cookie。
  - `aura_library_store.py`: 本地媒体库管理，处理用户的阅读历史、自定义收藏夹以及笔记。
- `providers/`: 漫画数据源的提供者抽象模式。
  - `base.py`: 定义了通用的 `ComicProvider` 接口协议。
  - `jm_provider.py`: 实现了具体的 JMComic 数据源供给。
- `db/`: 数据库模块。包含 `database.py` 用于 SQLAlchemy 引擎初始化，支持 v1.4.0 引入的外部数据库特性。

### 2.2 前端模块 (`frontend/`)
- `app.js`: 包含所有 Vue 3 组件逻辑。核心包含路由状态切换、状态共享以及漫画图片防盗链解密组件（`DescrambledImage`）。
- `app-loader.js`: 应用入口加载器，负责将 Vue 实例挂载到 HTML 并在前端发起初始认证检查。
- `views/*.html`: 应用中各个页面的视图模板（如 `home.html`, `detail.html`, `reader.html` 等）。

---

## 3. 关键类与函数说明 (Key Classes & Functions)

### 3.1 `backend/jm_service.py` -> `JmService` 类
- **职责**：项目与 JMComic 源站之间的核心桥梁。
- **关键函数**：
  - `get_client()`: 根据当前的配置文件或 Cookie 构建并返回 `JmHtmlClient` 对象。
  - `search(query, page)`: 调用源站 API 进行关键词搜索并初步解析搜索结果。
  - `get_album_detail(album_id)`: 获取指定漫画的元数据（标题、作者、描述、章节列表等），并处理单话/多话的不同数据结构。
  - `download_album_zip(album_id)`: 将指定漫画下载到临时目录，并将其打包成 ZIP 格式提供给用户下载。

### 3.2 `backend/download_task_manager.py` -> `DownloadTaskManager` 类
- **职责**：管理漫画的后台异步下载。
- **说明**：通过线程池控制并发，在后台调用 `jmcomic` 的下载能力，同时向前端提供进度查询 API（`/api/download/tasks/{task_id}`）。

### 3.3 `backend/core/api_adapter.py` -> 数据适配函数
- **`adapt_search_result(data)`**: 格式化搜索结果列表。
- **`adapt_album_detail(data)`**: 提取源数据中的标签（`_extract_tags`）、更新时间（`_extract_update_time`），并补全图片域名等信息。

### 3.4 `frontend/app.js` -> `DescrambledImage` Vue 组件
- **职责**：负责在前端对 JMComic 的防盗链“拼图”进行复原。
- **核心逻辑 (`startLoad`, `getSegmentationNum`, `cutImage`)**：
  - 提取 `epsId` 和 `scrambleId`。
  - 利用 MD5 (`calculateMD5`) 计算图片的哈希值，决定图片的切割块数（10块、或者更多）。
  - 使用 HTML5 `<canvas>` 的 `drawImage` API，按照倒序或特定算法将错位的图像块拼接到画布上，还原真实画面。

---

## 4. 依赖关系 (Dependencies)

项目依赖分为 Python 后端依赖与前端库依赖：

### 4.1 Python 后端依赖 (`requirements.txt`)
- **Web 框架体系**：`fastapi` (>=0.110), `uvicorn` (>=0.23), `python-multipart`
- **核心爬虫与解析**：`jmcomic` (>=2.4.3) - 用于提供禁漫天堂的爬虫基础能力。
- **网络与请求**：`requests` (>=2.31), `urllib3` (>=2.0)
- **数据持久化**：`SQLAlchemy` (>=2.0), `PyMySQL` (>=1.1) (外部数据库支持)
- **配置与其它**：`PyYAML` (>=6.0), `python-dotenv`, `pillow` (图片处理)

### 4.2 前端依赖 (通过 CDN 或本地静态资源)
- **Vue 3**: `vue.global.prod.min.js` (无构建工具的全局导入方式)
- **CryptoJS**: 用于计算图片拼接算法中必需的 MD5 哈希。
- **TailwindCSS**: UI 样式设计（通常通过 CDN 引入）。

---

## 5. 项目运行方式 (How to Run)

### 5.1 本地开发与前台启动
确保你的机器拥有可以访问源站的网络环境。

1. **环境准备**
   安装 Python 3.10+。
   ```bash
   # 克隆代码或解压源码
   cd JM-Aura
   
   # 创建并激活虚拟环境
   python3 -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   ```

2. **安装依赖**
   ```bash
   pip install -r requirements.txt
   ```

3. **启动服务**
   ```bash
   # Linux / macOS
   JM_AURA_HOST=0.0.0.0 JM_AURA_PORT=8000 python -m backend.main
   
   # Windows
   set JM_AURA_HOST=0.0.0.0
   set JM_AURA_PORT=8000
   python -m backend.main
   ```

4. **访问**
   打开浏览器访问 `http://127.0.0.0:8000` 即可进入 Web 界面。

### 5.2 进阶配置
- **环境变量**：可以通过在根目录创建 `.env` 文件来配置额外的数据库或其他高级设置。
- **账号登录**：第一次访问时，可以在 Web 页面上的 **设置 (Config)** 中输入 JMComic 的账号密码进行登录，密码凭证会保存在 `backend/config/` 中。
