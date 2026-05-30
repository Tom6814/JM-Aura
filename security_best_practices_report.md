# 安全审计报告（中等及以上已确认漏洞）

## 0. 执行摘要

本次审计聚焦于“可论证的端到端利用路径”的中等严重度及以上问题。结论：发现 3 个已确认漏洞，其中 2 个高危、1 个中危。核心风险来自：

- 部署包内携带真实 JM 会话 Cookie，且 Cookie 文件按站点用户名自动加载，导致可通过注册同名用户直接劫持既有 JM 会话。
- 存在对外开放的任意 URL 拉取接口（Open Proxy/SSRF），在缺少严格目标校验的情况下可被滥用访问服务端可达资源。
- 新实例初始化时“首个注册用户自动成为管理员”，若实例暴露在公网会导致抢注式提权。

## 1. 代码库架构与信任边界（简述）

- 入口：FastAPI 应用 [backend/main.py](file:///workspace/backend/main.py)。
- 前端：静态页面位于 `frontend/`，由后端通过 `StaticFiles` 与若干文件路由返回。
- 站点认证：
  - 站点账号/会话：`backend/core/site_auth.py`（JSON 文件存储用户与会话）。
  - 中间件：`backend/main.py` 的 `site_auth_middleware` 将站点用户写入 `current_site_user`，并构造 `current_jm_identity` 用于区分 JM 会话上下文。
- 与 JM 的交互：
  - `backend/core/req.py` / `backend/providers/jm_provider.py` 通过 `requests.Session` 对 JM/相关域名发起请求。
  - JM Cookie 持久化：`backend/core/http_session.py` 将 Cookie 读写到 `backend/config/cookies/*.json`（非 frozen 模式）。

信任边界：

- 外部用户 HTTP 请求 → FastAPI 路由（不可信输入）
- FastAPI → 本地文件系统（cookies/credentials/session 文件）
- FastAPI → 出站网络（JM API、图片代理、DoH 等）

## 2. 高危

### V-001（高危）部署包内携带真实 JM 会话 Cookie + Cookie 文件按站点用户名自动加载，导致“注册同名用户即可劫持既有 JM 会话”

**攻击者画像**

- 外部未认证用户（只需能访问服务的注册接口）。

**可控输入向量**

- `POST /api/site/register` 的 `username`（攻击者可选择与服务器上已存在 Cookie 文件同名的用户名，如 `alice`、`Tom6814` 等）。

**从输入到漏洞的确切代码路径**

1. 攻击者注册站点账号：
   - [backend/main.py:L342-L372](file:///workspace/backend/main.py#L342-L372) `site_register()`：
     - `create_site_user(auth.username, auth.password, admin=admin_flag)`
     - `sid = create_site_session(auth.username)` 并设置会话 Cookie。
2. 后续请求进入中间件，构造 JM 身份标识：
   - [backend/main.py:L185-L223](file:///workspace/backend/main.py#L185-L223) `site_auth_middleware()`：
     - `u, is_auth, ... = get_effective_user(request)`（已登录则 `is_auth=True` 且 `u=用户名`）
     - `identity = str(u)`；若无已绑定 JM active 用户，则 `identity` 仍为站点用户名
     - `current_jm_identity.set(identity)`
3. 任意触发 JM 请求的 API（如收藏列表）会读取该身份对应的 Cookie 文件：
   - [backend/core/req.py:L153-L181](file:///workspace/backend/core/req.py#L153-L181) `ServerReq.execute()` → `session = get_session()`
   - [backend/core/http_session.py:L50-L75](file:///workspace/backend/core/http_session.py#L50-L75) `get_session()` → `load_cookies(u)`
   - [backend/core/http_session.py:L78-L92](file:///workspace/backend/core/http_session.py#L78-L92) `load_cookies()`：
     - `p = _cookie_file_path(u)` → `backend/config/cookies/{safe_user_key(u)}.json`
     - `s.cookies = cookiejar_from_dict(data)`
4. 仓库内已存在真实 Cookie 文件：
   - 例如 [backend/config/cookies/111.json](file:///workspace/backend/config/cookies/111.json)（仓库中可见多个同类文件）。

**影响**

- 站点攻击者无需知道 JM 账号密码，只要注册一个与 Cookie 文件同名的站点用户名，即可让服务端自动加载既有 JM Cookie，从而：
  - 读取该 JM 会话可访问的数据（例如收藏、历史、章节/图片资源等）。
  - 以该 JM 会话身份执行操作（例如收藏切换、评论/点赞等，取决于会话权限与 JM 接口能力）。
- 等价于“内置/遗留会话凭证导致的账号接管”，属于高危敏感凭证泄露与越权。

**修复建议**

- 立即从仓库与发布制品中移除 `backend/config/cookies/*.json`（仅保留空的 `cookies.example.json`），并将 `backend/config/cookies/` 加入忽略规则（.gitignore / 打包忽略）。
- 将 Cookie/凭证存储迁移到实例私有路径（例如 `app_data_dir()` 或显式配置路径），并在启动时拒绝加载“预置 Cookie”。
- 将 JM Cookie 与站点账号强绑定：首次绑定必须通过用户显式登录 JM 生成；严禁“按用户名直接命中 Cookie 文件”的隐式继承行为。

### V-002（高危）`/api/image-proxy` 可被滥用为 Open Proxy/SSRF：外部用户可令服务端对任意 URL 发起请求并回传响应

**攻击者画像**

- 外部未认证用户（该接口未做登录校验）。

**可控输入向量**

- `GET /api/image-proxy?url=<attacker_controlled_url>` 的 `url` 参数。

**从输入到漏洞的确切代码路径**

- [backend/main.py:L1792-L1832](file:///workspace/backend/main.py#L1792-L1832) `image_proxy(url: str)`：
  - 解析并接受任意 `http/https` URL。
  - 仅做极弱的目标限制：
    - [backend/main.py:L1799-L1806](file:///workspace/backend/main.py#L1799-L1806) 仅阻止 `localhost/127.0.0.1/::1/192.168.*`，未覆盖：
      - 其他 loopback：`127.0.0.2/127.1/127.255.255.254` 等
      - 其他私有网段：`10.0.0.0/8`、`172.16.0.0/12`
      - 链路本地：`169.254.0.0/16`
      - IPv6 私有/本地地址段
  - 服务端发起请求并将响应直接流式回传给调用者：
    - `resp = session.get(url, ..., stream=True, ...)`
    - `return StreamingResponse(resp.iter_content(...), media_type=...)`

**影响**

- Open Proxy：攻击者可利用该服务端对外发起请求并回传内容，用于隐藏真实来源、绕过目标站点对客户端的限制、对第三方发起滥用流量。
- SSRF：攻击者可请求服务端可达的内部/本地 HTTP 资源并回传响应（例如内网管理面板、云元数据服务、内部 API），造成敏感数据泄露与进一步横向移动风险。

**修复建议**

- 使用严格 allowlist：仅允许拉取 JM 官方图片域名/已知 CDN 域名；拒绝任意域名输入。
- 在发起请求前做“解析后 IP”校验：解析域名到 IP，拒绝所有私有/回环/链路本地/保留地址段（IPv4/IPv6 全覆盖），并禁止跟随重定向到非 allowlist。
- 增加响应校验与限流：仅允许 `Content-Type: image/*`，限制最大下载大小、限制响应时间、限制并发与每 IP 速率。

## 3. 中危

### V-003（中危）新实例初始化阶段“首个注册用户自动成为管理员”，可被公网抢注提权

**攻击者画像**

- 外部未认证用户（抢在真实管理员之前完成注册）。

**可控输入向量**

- `POST /api/site/register`（任意用户名/密码）。

**从输入到漏洞的确切代码路径**

- [backend/main.py:L342-L372](file:///workspace/backend/main.py#L342-L372) `site_register()`：
  - `admin_flag = not has_any_site_user()`
  - `create_site_user(..., admin=admin_flag)`：当系统尚无用户时，首个注册者直接成为管理员。
- 管理接口示例：
  - [backend/main.py:L288-L300](file:///workspace/backend/main.py#L288-L300) `/api/site/admin/create-user` 仅基于 `is_site_admin(admin_u)` 判断权限。

**影响**

- 当服务首次部署且暴露在公网时，攻击者可通过抢先注册获得管理员权限，进而在站点内创建/管理用户，破坏访问控制边界。

**修复建议**

- 禁用“首个用户自动管理员”的逻辑，改为显式初始化流程（安装口令/一次性 setup token/仅本地回环初始化等）。
- 若必须保留开放注册：至少增加“初始化开关”与管理员种子密码（从环境变量/一次性 token 注入），并记录初始化完成状态后永久关闭该路径。

