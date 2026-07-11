# Zeabur 双服务部署说明

本文档说明如何把当前项目拆成 `web` 与 `api` 两个 Zeabur 服务部署，同时保持本地开发流程不变。根级 `zeabur.yaml` 用来显式声明这两个服务与各自 Dockerfile 所在位置。

## 服务划分

### web

- 作用：运行 Remix 页面服务
- 服务目录：`web/`
- Dockerfile：`web/Dockerfile`
- 关键源码：`web/app/`
- 构建脚本：`npm run build:web`
- 启动脚本：`npm run start:web`

### api

- 作用：运行 Hono API 服务
- 服务目录：`api/`
- Dockerfile：`api/Dockerfile`
- 关键源码：`api/src/server/`
- 构建脚本：`npm run build:api`
- 启动脚本：`npm run start:api`

## 本地开发

本地仍按双进程方式运行：

```bash
npm run dev:api
npm run dev:web
```

当 Remix 请求来自 `localhost` 或 `127.0.0.1` 且端口不是 `8787` 时，`web/app/lib/jm-rpc.server.ts` 会继续自动回退到 `http://127.0.0.1:8787`，因此不需要额外设置 `API_ORIGIN`。

## Zeabur 配置文件

根级 `zeabur.yaml`：

```yaml
services:
  web:
    root: ./web
    dockerfile: Dockerfile
  api:
    root: ./api
    dockerfile: Dockerfile
```

这样 Zeabur 会分别在 `web/` 与 `api/` 目录下使用各自的 `Dockerfile`。

## Zeabur 部署步骤

### 1. 创建 api 服务

- 仓库来源：当前项目仓库
- 服务目录：`api/`
- Dockerfile：`api/Dockerfile`
- 暴露端口：`8787`（或直接使用 Zeabur 注入的 `PORT`）

建议环境变量：

```env
PORT=8787
JM_PROXY_URL=
TASK_CONCURRENCY=2
TASK_RUNNER_TIMEOUT_MS=900000
```

如果你需要通过代理访问 JM 上游，请填写 `JM_PROXY_URL`；否则可以留空。

### 2. 创建 web 服务

- 仓库来源：当前项目仓库
- 服务目录：`web/`
- Dockerfile：`web/Dockerfile`
- 暴露端口：`3000`（或直接使用 Zeabur 注入的 `PORT`）

关键环境变量：

```env
PORT=3000
API_ORIGIN=https://your-api-service.zeabur.app
```

`API_ORIGIN` 必须指向上一步 `api` 服务的公网地址。`getApiOrigin()` 会优先读取该值，并自动去掉尾部 `/`。

## 环境变量说明

| 变量 | 服务 | 必填 | 说明 |
| --- | --- | --- | --- |
| `API_ORIGIN` | web | Zeabur 双服务时必填 | Remix 服务访问 API 的基础地址 |
| `PORT` | web / api | 否 | 优先使用平台注入值；本地默认 web=3000、api=8787 |
| `JM_PROXY_URL` | api | 否 | API 访问上游 JM 时使用的代理地址 |
| `TASK_CONCURRENCY` | api | 否 | 后端导出任务并发数，默认 `2` |
| `TASK_RUNNER_TIMEOUT_MS` | api | 否 | 单个任务超时时间，默认 `900000` |

## 验证方式

部署完成后，至少检查以下几点：

1. 打开 `web` 服务首页能正常渲染。
2. 搜索、发现、详情等页面能正常请求 `api` 服务。
3. 登录、收藏、任务导出接口正常工作。
4. `web` 日志中不再出现错误的同源 API 请求地址。

## 相关文件

- `zeabur.yaml`
- `package.json`
- `web/app/lib/jm-rpc.server.ts`
- `web/Dockerfile`
- `api/src/server/index.ts`
- `api/Dockerfile`
- `.env.example`
