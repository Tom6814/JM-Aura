# Zeabur 双服务部署说明

本文档说明如何把当前项目作为 **Zeabur 官方模板** 导入，并自动创建 `web` 与 `api` 两个服务。根级 `zeabur.yaml` 现在使用官方 Template Resource 格式，而不是早期的简化自定义写法。Zeabur 官方模板格式要求 `apiVersion`、`kind`、`metadata`、`spec.services` 等字段，并支持 `GIT` 服务的 `repo`、`branch`、`rootDirectory` 与 `watchPaths` [$TRAE_REF](https://zeabur.com/docs/zh-CN/template/template-format)[$TRAE_REF](https://schema.zeabur.app/prebuilt.json)

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
          rootDirectory: web
    - name: api
      template: GIT
      domainKey: API_DOMAIN
      spec:
        source:
          source: GITHUB
          repo: 1149811888
          branch: v3.0.0-monorepo
          rootDirectory: api
```

这里最关键的是：

- `repo: 1149811888` 对应 GitHub 仓库 `Tom6814/JM-Aura`
- `branch: v3.0.0-monorepo` 指向当前 monorepo 分支
- `rootDirectory: web` / `rootDirectory: api` 告诉 Zeabur 分别从哪个子目录创建服务 [$TRAE_REF](https://schema.zeabur.app/prebuilt.json)

如果你的默认发布分支以后改成 `main`，只需要把 `branch` 改回 `main`。

## Zeabur 部署步骤

### 1. 通过模板导入

推荐方式不是“手动新建一个源码服务”，而是让 Zeabur 读取根目录 `zeabur.yaml`，把它当成模板一次性导入。  
这样 Zeabur 会直接创建两个服务：

- `web`
- `api`

并且自动套用：

- GitHub 仓库 ID
- 分支
- 子目录根路径
- 基础环境变量

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

所以通常不需要再手填，只要在部署向导里把：

- `WEB_DOMAIN`
- `API_DOMAIN`

这两个域名变量填好即可。变量系统和 `DOMAIN` 类型是 Zeabur 模板格式的官方能力 [$TRAE_REF](https://zeabur.com/docs/zh-CN/template/template-format)

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
- `package.json`
- `web/app/lib/jm-rpc.server.ts`
- `web/Dockerfile`
- `api/src/server/index.ts`
- `api/Dockerfile`
- `.env.example`
