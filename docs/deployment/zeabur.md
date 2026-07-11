# Zeabur 双服务部署说明

本文档说明如何按 Zeabur 当前公开规范部署这个 monorepo。实际可落地、最稳的方式不是把 `web/` 或 `api/` 直接当单独构建根目录，而是从 **仓库根目录 `/`** 创建两个 Git 服务，并让 Zeabur按服务名自动匹配根目录 `Dockerfile.web` 与 `Dockerfile.api`。Zeabur 官方文档对 monorepo Node.js 项目提供 `zbpack.json` / `zbpack.[service].json`、`app_dir`、`build_command`、`start_command` 配置，也支持按服务名自动匹配 `Dockerfile.<service-name>` [$TRAE_REF](https://zeabur.com/docs/en-US/guides/nodejs)[$TRAE_REF](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)

## 服务划分

### web

- 作用：运行 Remix 页面服务
- 服务目录：仓库根目录 `/`
- Dockerfile：`Dockerfile.web`
- 关键源码：`web/app/`
- 构建脚本：`npm run build:web`
- 启动脚本：`npm run start:web`

### api

- 作用：运行 Hono API 服务
- 服务目录：仓库根目录 `/`
- Dockerfile：`Dockerfile.api`
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

当前仓库提供两层配置：

1. 根级 `zeabur.yaml`
2. 根级 `zbpack.web.json` / `zbpack.api.json`

### `zbpack.web.json`

```json
{
  "app_dir": "/",
  "cache_dependencies": false,
  "build_command": "npm run build:web",
  "start_command": "npm run start:web",
  "dockerfile": {
    "name": "web"
  }
}
```

### `zbpack.api.json`

```json
{
  "app_dir": "/",
  "cache_dependencies": false,
  "build_command": "npm run build:api",
  "start_command": "npm run start:api",
  "dockerfile": {
    "name": "api"
  }
}
```

### `zeabur.yaml`

```yaml
apiVersion: zeabur.com/v1
kind: Template
metadata:
  name: JM-Aura-Remix v3.0.0
spec:
  services:
    - name: web
      template: GIT
      domainKey: WEB_DOMAIN
      dependencies:
        - api
      spec:
        source:
          source: GITHUB
          repo: 1149811888
          branch: v3.0.0-monorepo
    - name: api
      template: GIT
      domainKey: API_DOMAIN
      spec:
        source:
          source: GITHUB
          repo: 1149811888
          branch: v3.0.0-monorepo
```

这里最关键的是：

- `repo: 1149811888` 对应 GitHub 仓库 `Tom6814/JM-Aura`
- `branch: v3.0.0-monorepo` 指向当前 monorepo 分支
- 实际部署时建议从仓库根目录 `/` 创建服务，再由服务名和 `zbpack.<service>.json` / `Dockerfile.<service>` 决定构建方式 [$TRAE_REF](https://zeabur.com/docs/en-US/guides/nodejs)[$TRAE_REF](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)

如果你的默认发布分支以后改成 `main`，只需要把 `branch` 改回 `main`。

## Zeabur 部署步骤

### 1. 通过模板导入

推荐方式是从同一个仓库根目录 `/` 创建两个 Git 服务，并把服务名分别命名为：

- `web`
- `api`

这样 Zeabur 会优先：

- 读取 `zbpack.web.json` 或 `zbpack.api.json`
- 用 `Dockerfile.web` 或 `Dockerfile.api` 构建

这比把 Root Directory 改成 `/web` 或 `/api` 更稳，因为当前 Dockerfile 需要仓库根目录里的：

- `package.json`
- `package-lock.json`
- `packages/shared/`

### 2. api 服务环境变量

```env
PORT=8787
JM_PROXY_URL=
TASK_CONCURRENCY=2
TASK_RUNNER_TIMEOUT_MS=900000
```

如果你需要通过代理访问 JM 上游，请填写 `JM_PROXY_URL`；否则可以留空。

### 3. web 服务环境变量

关键环境变量：

```env
PORT=3000
API_ORIGIN=https://your-api-service.zeabur.app
```

如果你通过模板导入，`web` 服务默认已经会拿到：

```env
API_ORIGIN=https://${API_DOMAIN}
```

如果你通过普通 Git 服务创建方式部署，依然建议你手动填写：

- `WEB_DOMAIN`
- `API_DOMAIN`

如果只是普通服务，不使用模板变量，也至少要保证：

```env
API_ORIGIN=https://你的-api-服务公网域名
```

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
5. Zeabur 项目里会直接出现两个服务，而不是只识别成一个 `web` 服务。

## 相关文件

- `zeabur.yaml`
- `zbpack.web.json`
- `zbpack.api.json`
- `package.json`
- `web/app/lib/jm-rpc.server.ts`
- `Dockerfile.web`
- `api/src/server/index.ts`
- `Dockerfile.api`
- `.env.example`
