# 安全审计报告（周期性评估）

范围：本仓库当前代码状态（后端 FastAPI + 前端静态资源）。  
目标：仅报告中等严重度及以上、且具备可论证端到端利用路径的已确认漏洞；不包含推测性风险。

## 执行摘要

发现 1 个高危 SSRF（可直接回显内网/云元数据响应），以及 2 个中等风险问题（错误信息泄露、仓库中包含真实会话 Cookie 数据）。

---

## 高危（High）

### H-01：未授权 SSRF（带回显）— `/api/image-proxy`

- **攻击者画像**：外部未认证用户
- **可控输入向量**：HTTP GET 查询参数 `url`
- **端到端代码路径**
  - 入口：[main.py:L1792-L1832](file:///workspace/backend/main.py#L1792-L1832) `@app.get("/api/image-proxy")`
  - 逻辑：对 `urlparse(url)` 的 host 仅做非常有限的阻断（仅 `localhost/127.0.0.1/::1/192.168.*`），随后执行 `session.get(url, ...)` 并将响应内容通过 `StreamingResponse` 回传给调用方。
- **可利用性说明（PoC 思路）**
  - 直接访问云元数据（示例，未在代码中被阻断）：`/api/image-proxy?url=http://169.254.169.254/latest/meta-data/`
  - 内网探测：`/api/image-proxy?url=http://10.0.0.1:8080/`（当前逻辑不阻断 10/8、172.16/12、169.254/16 等私网/链路本地地址）
  - **重定向绕过**：requests 默认跟随重定向；即使未来补了 host 阻断，也需显式处理 30x，否则 `url=https://attacker.tld/redirect-to-internal` 仍可能跳转到内网地址。
- **影响**
  - 读取并回显内网 HTTP 服务响应（数据泄露）
  - 访问云环境元数据服务（凭据泄露/权限提升，取决于部署环境）
  - 内网端口扫描/服务指纹识别（为后续攻击提供情报）
- **修复建议**
  - 采用“域名白名单”策略：仅允许已知图片源域名/Host（例如 JM 官方域名与 CDN 列表）。
  - 如必须支持任意域名：对 `url` 做严格校验并实现“解析后 IP 阻断”：
    - DNS 解析 hostname → 获取全部 A/AAAA 记录；
    - 阻断 loopback、private、link-local、multicast、reserved 等网段（IPv4/IPv6）；
    - 阻断非 80/443 端口（或按需允许）；
    - 禁用重定向或对每一次跳转重新执行相同校验；
    - 设置读取大小上限与更细粒度超时，防止带宽/连接耗尽型 DoS。

---

## 中危（Medium）

### M-01：对外返回未处理异常详情（信息泄露）

- **攻击者画像**：外部未认证用户
- **可控输入向量**：任意能触发未捕获异常的 HTTP 请求（例如传入异常格式参数、触发第三方库异常等）
- **端到端代码路径**
  - 全局异常处理器：[main.py:L105-L112](file:///workspace/backend/main.py#L105-L112)
  - 返回体包含 `detail: str(exc)`，将服务端异常消息直接回显给客户端。
- **影响**
  - 泄露内部实现细节（文件路径、依赖库错误信息、上游响应片段等）
  - 在联动第三方错误信息时，可能间接泄露敏感配置/账号标识（取决于异常内容）
- **修复建议**
  - 生产环境统一返回固定错误码与通用错误消息（不包含内部异常文本）。
  - 异常细节仅写入服务端日志（并注意日志脱敏）。

### M-02：仓库包含真实会话 Cookie 数据（敏感信息泄露）

- **攻击者画像**：获得仓库读取权限的第三方（公开仓库访问者、供应链入侵者、CI 制品/镜像泄露场景等）
- **可控输入向量**：直接读取仓库文件（无需与服务交互）
- **证据位置**
  - 目录存在多份 cookie 数据文件：[/workspace/backend/config/cookies/](file:///workspace/backend/config/cookies)
  - 代表性文件：[/workspace/backend/config/cookies/111.json](file:///workspace/backend/config/cookies/111.json)、[/workspace/backend/config/cookies/Tom6814.json](file:///workspace/backend/config/cookies/Tom6814.json)
- **影响**
  - 若这些 Cookie 仍有效，攻击者可在目标站点侧进行会话劫持（以对应账号身份访问/操作）。
  - 即使已过期，也属于高风险资产落库并进入版本控制的“已发生泄露”证据。
- **修复建议**
  - 立即将 `backend/config/cookies/` 从版本库移除，并加入 `.gitignore`（仅保留 `cookies.example.json` 之类示例文件）。
  - 轮换/失效这些 Cookie 对应的站点会话（在源站登出所有设备/重置会话）。
  - 对运行时 cookie/凭据存储目录使用独立数据目录（例如放到用户目录或容器挂载卷），避免与源码目录混用。

