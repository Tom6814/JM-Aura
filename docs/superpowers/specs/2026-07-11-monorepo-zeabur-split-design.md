# Monorepo 拆分与 Zeabur 自动识别设计

日期：2026-07-11  
项目：`JM-Aura-Remix`

## 背景

当前项目虽然在逻辑上已经区分了前端页面层和后端 API 层，但仓库结构仍然是单根混合布局：

- `app/` 中放 Remix 页面
- `src/server/` 中放 Hono API
- 共享类型与工具分散在当前根目录结构里

这种布局本地开发可以工作，但对 Zeabur 并不自然。  
部署时，平台更容易把整个仓库识别成一个单服务，而不是明确的 `web` / `api` 双服务。这样会带来几个问题：

1. 部署体验不直观，容易误配成单服务。
2. 仓库结构对 GitHub 访问者不够清晰。
3. README、部署说明和代码结构之间不一致。
4. 后续扩展前后端时边界不够明确。

因此，本次目标不是只补一个部署配置文件，而是把仓库正式整理成适合长期维护的 monorepo 结构。

## 目标

- 将项目整理成清晰的 monorepo。
- 明确拆分出：
  - `web/`
  - `api/`
  - 共享代码目录
- 根目录保留 workspace、文档和部署入口。
- 补 `zeabur.yaml` 或等价配置，让 Zeabur 更自然识别并创建两个服务。
- 更新 README 与部署文档，使其和新结构一致。
- 保持最近已经完成的功能不回退：
  - 搜索修复
  - 桌面端顶栏重构
  - 下载任务与 session 隔离
  - 手机端导航

## 非目标

- 不重写业务逻辑架构。
- 不更换前端或后端技术栈。
- 不把运行时合并回单服务。
- 不引入新的重型 monorepo 工具链（如 Nx、Turborepo）作为本次前提。

## 设计概览

本次重构以“结构拆分优先，运行时逻辑尽量不动”为原则。

新的仓库顶层建议结构：

```text
.
├── web/                 # Remix 前端应用
├── api/                 # Hono 后端应用
├── packages/
│   └── shared/          # 共享 schema、类型、公共工具
├── docs/
├── archive/
├── package.json         # workspace 根配置
├── tsconfig.base.json   # 根级 TS 基础配置
├── zeabur.yaml          # Zeabur 双服务定义
└── README.md
```

这样可以实现：

- 对开发者来说：一眼看出前后端边界
- 对 Zeabur 来说：更容易识别两个服务
- 对 GitHub 访问者来说：仓库结构更标准

## 目录拆分

### web

`web/` 负责当前 Remix 应用，包括：

- 页面路由
- 组件
- 样式
- 前端侧 RPC 封装

预计迁移内容：

- 现有 `app/` 移入 `web/app/`
- Remix 构建配置移动到 `web/`
- 前端静态构建与启动脚本改为在 `web/` 下执行

### api

`api/` 负责 Hono API 和服务端任务系统，包括：

- `src/server/`
- 下载任务
- session 管理
- ZIP 导出

预计迁移内容：

- 现有 `src/server/` 移入 `api/src/server/`
- API 启动脚本与后端部署配置移动到 `api/`

### packages/shared

共享目录负责：

- schema
- 共享类型
- 前后端都依赖的轻量工具

预计迁移内容：

- 现有 `src/shared/` 移入 `packages/shared/src/`
- `web` 与 `api` 通过 workspace 依赖引用它

## 构建与脚本

### 根目录

根目录负责：

- workspace 定义
- 统一脚本入口
- 文档与部署配置

示意：

```json
{
  "private": true,
  "workspaces": ["web", "api", "packages/*"],
  "scripts": {
    "dev:web": "npm --workspace web run dev",
    "dev:api": "npm --workspace api run dev",
    "build:web": "npm --workspace web run build",
    "build:api": "npm --workspace api run build",
    "typecheck": "npm run typecheck --workspaces"
  }
}
```

### web 脚本

`web/package.json` 负责：

- Remix dev
- Remix build
- Web start

### api 脚本

`api/package.json` 负责：

- Hono API dev
- API build / typecheck
- API start

## TypeScript 配置

为了避免拆目录后 import 路径混乱：

- 根目录增加 `tsconfig.base.json`
- `web/tsconfig.json`
- `api/tsconfig.json`
- `packages/shared/tsconfig.json`

原则：

- 共用 compiler options 由根级 base 提供
- 各子项目只声明自己的 `rootDir` / `include` / `references`
- 共享目录通过显式 workspace 路径被引用

## Zeabur 配置

### 目标

让 Zeabur 更自然识别并创建两个服务，而不是把整个仓库理解成一个模糊单服务。

### 配置方式

根目录增加：

- `zeabur.yaml`

配置明确声明两个服务：

- `web`
- `api`

每个服务都指定：

- 工作目录
- 构建命令
- 启动命令
- Dockerfile 或运行入口

例如概念上会是：

```yaml
services:
  web:
    root: web
    dockerfile: Dockerfile
  api:
    root: api
    dockerfile: Dockerfile
```

具体字段名称可以按 Zeabur 实际支持格式调整，但目标不变：  
Zeabur 打开仓库后能明确看到两个服务定义。

### API 地址策略

即使拆成 monorepo，前端仍然通过环境变量读取 API 地址：

- 本地开发：继续兼容本地 `3000 / 8787`
- 部署环境：使用 `API_ORIGIN`

这个策略不变，只是配置文件和目录位置会迁移到 `web/` 与 `api/` 内。

## README 与文档

### README

README 需要和新 monorepo 结构保持一致：

- 明确当前版本是 `v3.0.0`
- 说明这是一次全面重构
- 说明与 `JM-Aura/` 的差异
- 更新目录结构说明
- 更新本地开发方式
- 更新 Zeabur 部署方式

### 部署文档

`docs/deployment/zeabur.md` 需要同步更新为新路径：

- `web/`
- `api/`
- 根级 `zeabur.yaml`

### 归档目录说明

`archive/README.md` 保持，但 README 里要说明：

- `archive/` 是历史参考，不是当前主线结构的一部分

## 迁移策略

### 原则

为了减少功能回归，这次迁移按以下顺序进行：

1. 先移动目录
2. 再修正 import 和配置
3. 再修脚本和构建
4. 再补 Zeabur 配置
5. 最后更新 README 和文档

### 原因

如果一开始就同时改运行时逻辑、目录结构和部署方式，容易把最近刚修好的功能一起打坏。  
因此本次尽量只做“工程结构重构”，不主动动业务逻辑。

## 性能原则

本次必须保持当前运行时性能模型不变：

- Remix loader 驱动页面
- 搜索仍是 GET + URL 驱动
- 下载任务轮询策略不变
- 不引入额外重前端状态
- 不因为 monorepo 拆分而增加运行时请求层级

也就是说：

- 结构变
- 部署变
- 运行时主策略不变

## 风险与取舍

### 不引入重型 monorepo 工具

虽然 Turborepo/Nx 可以做更完整的 pipeline 管理，但会显著增加配置复杂度。  
本次优先用 npm workspace + TS project config 做到“够清晰、够稳定”。

### 迁移成本

目录拆分会触及：

- import 路径
- tsconfig
- package 脚本
- Dockerfile
- 部署文档

因此这不是小改动，必须通过测试和分步迁移控制风险。

### Zeabur 自动识别

即使增加 `zeabur.yaml`，平台实际表现仍可能受其当前产品能力影响。  
因此本次目标是“尽量显式地定义两个服务”，而不是假设平台一定零配置全自动正确识别。

## 测试

### 功能回归

需要确认以下功能不回退：

- 首页搜索
- 桌面端顶栏搜索
- 桌面端头像菜单
- 手机端导航
- 下载任务列表
- session 隔离任务
- 删除任务与自动清理

### 构建与类型检查

需要验证：

- `web` 能单独 build
- `api` 能单独 build / start
- workspace 下 typecheck 正常
- shared 包被前后端正确引用

### 部署检查

需要验证：

- `zeabur.yaml` 可读
- `web` 与 `api` 的工作目录明确
- README 与实际目录一致

## 验收标准

- 仓库结构变成清晰的 monorepo
- 至少存在 `web/`、`api/` 和共享代码目录
- 根目录保留 workspace、文档和部署入口
- 最近已完成的搜索、顶栏、任务系统功能不回退
- 本地可以分别启动 `web` 与 `api`
- Zeabur 有明确的双服务配置入口
- README 与新结构、`v3.0.0`、`JM-Aura/` 差异说明保持一致
- 不引入额外重运行时复杂度
