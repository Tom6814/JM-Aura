# JM-Aura-Remix v3.0.0

> 中文 / English  
> Root project = current mainline release; `archive/` = legacy references and local artifacts.

---

## 中文

### 项目简介

`JM-Aura-Remix v3.0.0` 是当前仓库的主线版本。它以 Remix + React 负责 Web 页面，以 Hono + TypeScript 负责 API、任务和导出能力，目标是把阅读、搜索、收藏、详情、下载任务与双服务部署整理成更适合持续开发和发布的结构。

这次 `v3.0.0` 不只是样式调整，而是一次面向工程结构与部署方式的重构版本：

- 前端主站改为 Remix 路由与 SSR
- 后端主服务改为 Hono API
- 本地开发保持 `web` / `api` 双进程
- Zeabur 部署明确拆分为 `web` / `api` 双服务
- 历史项目与本地工具产物统一收进 `archive/`

### 与 `JM-Aura/` 的差异

当前根目录项目与 `archive/JM-Aura/` 的定位不同：

| 项目 | 定位 | 主要技术栈 | 部署方式 |
| --- | --- | --- | --- |
| 当前根目录 `JM-Aura-Remix` | 推荐使用的主线版本 | Remix + React + Hono + TypeScript | `web` / `api` 双服务 |
| `archive/JM-Aura/` | 旧版历史参考 | FastAPI + Vue 3（CDN）+ Python | 单体后端分发页面 |

可以把它理解为：

- `JM-Aura/` 是旧架构、旧实现和历史参考资料
- 当前根目录是继续演进的 `v3.0.0` 主线项目
- 若要开发、部署、提交新改动，应以当前根目录为准，而不是以 `archive/JM-Aura/` 为准

### Quick Start / 快速开始

#### 1. 安装依赖

```bash
npm ci
```

#### 2. 本地开发

分别启动 API 与 Web：

```bash
npm run dev:api
npm run dev:web
```

默认情况下：

- API: `http://127.0.0.1:8787`
- Web: `http://127.0.0.1:3000`（Remix dev 也可能使用其它本地端口）

当 Web 运行在本地 `localhost` / `127.0.0.1` 且端口不是 `8787` 时，服务端 RPC 会自动回退到 `http://127.0.0.1:8787`，所以本地通常不需要额外设置 `API_ORIGIN`。

#### 3. 常用脚本

```bash
npm run typecheck
npm run build:web
npm run build:api
npm run build
npm run start:web
npm run start:api
```

### 环境变量

项目示例见根目录 `.env.example`：

| 变量 | 服务 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `API_ORIGIN` | web | Zeabur 双服务部署时必填 | 指向 API 服务公网地址 |
| `PORT` | web / api | 否 | 本地默认 web=3000、api=8787；部署时优先读取平台注入值 |
| `JM_PROXY_URL` | api | 否 | API 访问上游站点时使用的代理 |
| `TASK_CONCURRENCY` | api | 否 | 下载 / 导出任务并发数 |
| `TASK_RUNNER_TIMEOUT_MS` | api | 否 | 单任务超时时间 |

### Zeabur 双服务部署

当前仓库已经按双服务部署整理：

- 根级 `zeabur.yaml` 显式声明 `web` / `api` 两个服务
- `web` 服务使用 `web/Dockerfile`
- `api` 服务使用 `api/Dockerfile`

部署步骤如下：

#### 1. 创建 `api` 服务

- 仓库来源：当前仓库
- 服务目录：`api/`
- Dockerfile：`api/Dockerfile`
- 端口：`8787`（或使用 Zeabur 注入的 `PORT`）

建议环境变量：

```env
PORT=8787
JM_PROXY_URL=
TASK_CONCURRENCY=2
TASK_RUNNER_TIMEOUT_MS=900000
```

#### 2. 创建 `web` 服务

- 仓库来源：当前仓库
- 服务目录：`web/`
- Dockerfile：`web/Dockerfile`
- 端口：`3000`（或使用 Zeabur 注入的 `PORT`）

关键环境变量：

```env
PORT=3000
API_ORIGIN=https://your-api-service.zeabur.app
```

其中 `API_ORIGIN` 必须指向第 1 步创建出来的 `api` 公网地址。

#### 3. 部署后检查

至少确认以下几点：

1. `web` 首页能正常打开
2. 搜索、发现、详情页能正常请求 `api`
3. 登录、收藏、任务导出接口可正常使用
4. `web` 不再错误地请求自身同源 API 地址

更详细的部署说明见 `docs/deployment/zeabur.md`，其中包含 `zeabur.yaml`、`web/app`、`api/src/server` 与环境变量的对应关系。

### 仓库结构

```text
.
├── zeabur.yaml              # Zeabur 双服务定义
├── web/
│   ├── app/                 # Remix 页面与组件
│   └── Dockerfile           # Web 服务镜像
├── api/
│   ├── src/
│   │   └── server/          # Hono API、任务与导出能力
│   └── Dockerfile           # API 服务镜像
├── packages/
│   └── shared/
│       └── src/             # 共享 schema 与类型
├── cli/                     # CLI 相关代码
├── docs/                    # 设计/计划/部署文档
├── .env.example             # 环境变量示例
└── archive/                 # 历史版本与本地工具产物
```

### Archive / 归档说明

下列内容已经移入 `archive/`，避免干扰当前主项目结构：

- `archive/JM-Aura/`
- `archive/JMComic-Crawler-Python-master/`
- `archive/.superpowers/`
- `archive/.trae-html-share-packages/`
- `archive/ai-agent-handoff-2026-07-09/`

这些内容保留用于历史参考、迁移对照或本地工具痕迹，不应再作为当前版本的主项目入口。

---

## English

### Overview

`JM-Aura-Remix v3.0.0` is the current mainline release in this repository. It uses Remix + React for the web app and Hono + TypeScript for the API, task pipeline, and export flows. The goal of `v3.0.0` is to make the project easier to develop, deploy, and ship as a modern dual-service application.

This release is a repository and architecture refresh, not just a UI pass:

- the main web app is now built on Remix routes and SSR
- the backend is organized as a Hono API service
- local development keeps `web` and `api` as two processes
- Zeabur deployment is documented as two separate services
- legacy projects and local tool artifacts are moved under `archive/`

### What changed from `JM-Aura/`

The root project and `archive/JM-Aura/` do not serve the same purpose:

| Project | Role | Main stack | Deployment model |
| --- | --- | --- | --- |
| Root `JM-Aura-Remix` | recommended active mainline | Remix + React + Hono + TypeScript | split `web` + `api` services |
| `archive/JM-Aura/` | legacy reference | FastAPI + Vue 3 (CDN) + Python | monolithic backend serving pages |

In short:

- `JM-Aura/` is retained as a historical reference
- the repository root is the active `v3.0.0` line
- new development and deployment should target the root project, not the archived legacy app

### Quick Start

#### 1. Install dependencies

```bash
npm ci
```

#### 2. Run locally

Start the API and web app separately:

```bash
npm run dev:api
npm run dev:web
```

Typical local addresses:

- API: `http://127.0.0.1:8787`
- Web: `http://127.0.0.1:3000`

When the web app is running on local `localhost` / `127.0.0.1` and not on port `8787`, the server-side RPC layer automatically falls back to `http://127.0.0.1:8787`, so `API_ORIGIN` is usually not required during local development.

#### 3. Useful scripts

```bash
npm run typecheck
npm run build:web
npm run build:api
npm run build
npm run start:web
npm run start:api
```

### Environment variables

See `.env.example` for the baseline template.

| Variable | Service | Required | Purpose |
| --- | --- | --- | --- |
| `API_ORIGIN` | web | required for Zeabur split deployment | public base URL of the API service |
| `PORT` | web / api | no | defaults are web=3000 and api=8787 locally |
| `JM_PROXY_URL` | api | no | upstream proxy used by the API service |
| `TASK_CONCURRENCY` | api | no | download/export task concurrency |
| `TASK_RUNNER_TIMEOUT_MS` | api | no | timeout for a single task |

### Zeabur dual-service deployment

This repository is prepared for a split deployment:

- root `zeabur.yaml` declares the `web` and `api` services explicitly
- `web` uses `web/Dockerfile`
- `api` uses `api/Dockerfile`

#### 1. Create the `api` service

- source: this repository
- service directory: `api/`
- Dockerfile: `api/Dockerfile`
- port: `8787` or the platform-injected `PORT`

Recommended variables:

```env
PORT=8787
JM_PROXY_URL=
TASK_CONCURRENCY=2
TASK_RUNNER_TIMEOUT_MS=900000
```

#### 2. Create the `web` service

- source: this repository
- service directory: `web/`
- Dockerfile: `web/Dockerfile`
- port: `3000` or the platform-injected `PORT`

Required variable:

```env
PORT=3000
API_ORIGIN=https://your-api-service.zeabur.app
```

`API_ORIGIN` must point to the public URL of the API service created in step 1.

#### 3. Validate the deployment

Check at least the following:

1. the `web` home page renders correctly
2. search, discover, and detail pages can reach the `api`
3. login, favorites, and export tasks still work
4. the `web` service no longer makes incorrect same-origin API requests

Detailed deployment notes are available in `docs/deployment/zeabur.md`, including how `zeabur.yaml`, `web/app`, `api/src/server`, and the required environment variables line up.

### Repository layout

```text
.
├── zeabur.yaml              # Zeabur service manifest
├── web/
│   ├── app/                 # Remix routes and UI
│   └── Dockerfile           # web image
├── api/
│   ├── src/
│   │   └── server/          # Hono API, tasks, and exports
│   └── Dockerfile           # api image
├── packages/
│   └── shared/
│       └── src/             # shared schema and types
├── cli/                     # CLI-related source
├── docs/                    # specs, plans, deployment notes
├── .env.example             # environment template
└── archive/                 # legacy references and local artifacts
```

### Archive notes

The following paths are intentionally moved into `archive/`:

- `archive/JM-Aura/`
- `archive/JMComic-Crawler-Python-master/`
- `archive/.superpowers/`
- `archive/.trae-html-share-packages/`
- `archive/ai-agent-handoff-2026-07-09/`

They are preserved for historical reference, migration comparison, or local tooling traces, but they are not part of the active mainline project layout.
