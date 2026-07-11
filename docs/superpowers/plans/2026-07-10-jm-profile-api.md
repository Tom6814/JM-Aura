# JM 用户资料 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Hono 新增独立的 `GET /api/profile`，并让“我的”页并行读取并展示头像、昵称、等级、称号、签名等 JM 用户资料。

**Architecture:** 后端继续复用现有 `JmSessionManager -> JMComicClient` 链路，在 `JMComicClient` 内集中做 Python 原版资料字段的轻量映射；`src/server/index.ts` 暴露稳定 profile 响应结构。前端通过 `app/lib/jm-rpc.server.ts` 新增 `fetchProfile()`，`/me` loader 并行读取 `favorites/profile/tasks`，资料区单独降级，避免 profile 失败拖垮整个“我的”页。

**Tech Stack:** Hono, Remix, TypeScript, Zod, Node test runner, React server rendering tests

---

> 备注：当前工作区不是 git 仓库。下面的 `git commit` 步骤假设你在正式仓库/克隆中执行；如果仍然没有 `.git`，先完成代码与测试，再在可提交的仓库里补 commit。

## 文件结构

### 后端

- Modify: `src/shared/schema.ts`
  - 新增 profile 数据结构与 API 响应 schema
- Modify: `src/server/jmClient.ts`
  - 新增 profile 抓取与字段归一化 helper
- Modify: `src/server/index.ts`
  - 新增 `GET /api/profile`
- Modify: `src/server/index.test.ts`
  - 覆盖 profile 未登录、完整映射、缺字段降级

### 前端 RPC / 路由

- Modify: `app/lib/jm-rpc.server.ts`
  - 新增 `fetchProfile()`
- Modify: `app/routes/me.tsx`
  - 新增 `ProfileState`、并行 loader、局部 retry

### 前端展示

- Modify: `app/components/profile.tsx`
  - 展示真实头像/昵称/等级/称号/签名，保留失败降级
- Modify: `app/components/profile.test.tsx`
  - 覆盖名称优先级、资料展示、profile 失败不拖垮 favorites/tasks

---

### Task 1: 定义 profile schema 与后端映射测试

**Files:**
- Modify: `src/shared/schema.ts`
- Modify: `src/server/index.test.ts`

- [ ] **Step 1: 在 `src/server/index.test.ts` 先写失败测试，锁定 `GET /api/profile` 的 shape**

```ts
test("GET /api/profile returns normalized profile fields", async () => {
  const originalRequestApi = JMComicClient.prototype.requestApi;
  JMComicClient.prototype.requestApi = async function requestApiMock(path) {
    if (path === "/user/profile") {
      return {
        response: new Response(),
        envelope: { code: 200, data: "" },
        ts: "0",
        encoded_data: "",
        decoded_data: "{}",
        data: {
          username: "jm_user",
          nickname: "小鲸鱼",
          avatar: "https://cdn.example/avatar.jpg",
          level: "12",
          title: "至尊会员",
          badge: "年度徽章",
          signature: "漫读者",
        } as never,
      };
    }
    throw new Error(`unexpected path: ${path}`);
  };

  try {
    const response = await app.request(new Request("http://localhost/api/profile"));
    assert.equal(response.status, 200);
    const json = (await response.json()) as any;

    assert.equal(json.isLoggedIn, true);
    assert.equal(json.profile.nickname, "小鲸鱼");
    assert.equal(json.profile.level, "12");
    assert.equal(json.profile.title, "至尊会员");
    assert.equal(json.profile.badge, "年度徽章");
    assert.equal(json.profile.signature, "漫读者");
  } finally {
    JMComicClient.prototype.requestApi = originalRequestApi;
  }
});

test("GET /api/profile degrades missing fields to null", async () => {
  const originalRequestApi = JMComicClient.prototype.requestApi;
  JMComicClient.prototype.requestApi = async function requestApiMock(path) {
    if (path === "/user/profile") {
      return {
        response: new Response(),
        envelope: { code: 200, data: "" },
        ts: "0",
        encoded_data: "",
        decoded_data: "{}",
        data: {
          username: "jm_user",
        } as never,
      };
    }
    throw new Error(`unexpected path: ${path}`);
  };

  try {
    const response = await app.request(new Request("http://localhost/api/profile"));
    assert.equal(response.status, 200);
    const json = (await response.json()) as any;

    assert.equal(json.isLoggedIn, true);
    assert.equal(json.profile.nickname, null);
    assert.equal(json.profile.avatar, null);
    assert.equal(json.profile.level, null);
    assert.equal(json.profile.title, null);
    assert.equal(json.profile.badge, null);
    assert.equal(json.profile.signature, null);
  } finally {
    JMComicClient.prototype.requestApi = originalRequestApi;
  }
});
```

- [ ] **Step 2: 运行测试，确认它因接口/类型尚不存在而失败**

Run: `node --import tsx --test src/server/index.test.ts`  
Expected: FAIL，提示 `/api/profile` 未实现或响应字段不存在

- [ ] **Step 3: 在 `src/shared/schema.ts` 写最小 profile schema**

```ts
export const profileSchema = z
  .object({
    username: z.string().nullable(),
    nickname: z.string().nullable(),
    avatar: z.string().nullable(),
    level: z.string().nullable(),
    title: z.string().nullable(),
    badge: z.string().nullable(),
    signature: z.string().nullable(),
  })
  .strict();

export type Profile = z.infer<typeof profileSchema>;

export const profileResultSchema = z
  .object({
    isLoggedIn: z.boolean(),
    profile: profileSchema.nullable(),
    authMessage: z.string(),
    error: z.string().nullable(),
  })
  .strict();

export type ProfileResult = z.infer<typeof profileResultSchema>;
```

- [ ] **Step 4: 先不实现接口，只跑类型与测试看失败是否收敛到“路由缺失/断言失败”**

Run: `node --import tsx --test src/server/index.test.ts`  
Expected: 仍然 FAIL，但不再是 schema 未定义或 import 错误

- [ ] **Step 5: Commit**

```bash
git add src/shared/schema.ts src/server/index.test.ts
git commit -m "test: add profile api schema coverage"
```

---

### Task 2: 在 Hono 中实现独立 `GET /api/profile`

**Files:**
- Modify: `src/server/jmClient.ts`
- Modify: `src/server/index.ts`
- Test: `src/server/index.test.ts`

- [ ] **Step 1: 继续补失败测试，覆盖未登录结构**

```ts
test("GET /api/profile returns logged-out structure when upstream requires login", async () => {
  const originalRequestApi = JMComicClient.prototype.requestApi;
  JMComicClient.prototype.requestApi = async function requestApiMock() {
    const error = new Error("禁漫API请求失败，code=401，msg=請先登入會員");
    throw error;
  };

  try {
    const response = await app.request(new Request("http://localhost/api/profile"));
    assert.equal(response.status, 200);
    const json = (await response.json()) as any;

    assert.equal(json.isLoggedIn, false);
    assert.equal(json.profile, null);
    assert.match(json.authMessage, /登录后/);
    assert.equal(typeof json.error, "string");
  } finally {
    JMComicClient.prototype.requestApi = originalRequestApi;
  }
});
```

- [ ] **Step 2: 运行测试，确认未登录结构测试失败**

Run: `node --import tsx --test src/server/index.test.ts`  
Expected: FAIL，`/api/profile` 仍不存在或返回不是预期结构

- [ ] **Step 3: 在 `src/server/jmClient.ts` 新增最小 profile 抓取方法**

```ts
async fetchProfile() {
  const response = await this.requestApi<Record<string, unknown>>("/user/profile");
  return response.data;
}
```

如果你在代码库里发现 Python 原版实际不是 `/user/profile`，以原版真实路径替换上面这个常量，并在 `index.test.ts` 一并同步。

- [ ] **Step 4: 在 `src/server/index.ts` 实现映射 helper 与接口**

```ts
function mapProfileField(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getNullableString(data[key]);
    if (value && value.trim().length > 0) return value.trim();
  }
  return null;
}

function mapUserProfile(input: unknown) {
  const data = ensureRecord(input, "profile");
  return profileSchema.parse({
    username: mapProfileField(data, ["username", "user_name", "name"]),
    nickname: mapProfileField(data, ["nickname", "nick_name", "show_name"]),
    avatar: mapProfileField(data, ["avatar", "avatar_url", "photo"]),
    level: mapProfileField(data, ["level", "level_name", "grade"]),
    title: mapProfileField(data, ["title", "rank_title", "user_title"]),
    badge: mapProfileField(data, ["badge", "badge_name", "frame_title"]),
    signature: mapProfileField(data, ["signature", "sign", "brief"]),
  });
}

app.get("/api/profile", async (c) => {
  const session = sessionManager.get(c.req.raw);
  const cookie = getSessionCookieHeaderValueIfNeeded(c.req.raw, session);
  if (cookie) c.header("Set-Cookie", cookie);

  try {
    const raw = await session.client.fetchProfile();
    return c.json(
      profileResultSchema.parse({
        isLoggedIn: true,
        profile: mapUserProfile(raw),
        authMessage: "当前会话已连接，可同步头像与资料。",
        error: null,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "资料同步失败，请稍后重试。";
    const isAuthError = /401|請先登入會員|未登录|Need login/i.test(message);

    return c.json(
      profileResultSchema.parse({
        isLoggedIn: !isAuthError,
        profile: null,
        authMessage: isAuthError
          ? "登录后可同步头像、等级、称号与签名。"
          : "当前资料区没有同步成功。",
        error: message,
      }),
    );
  }
});
```

- [ ] **Step 5: 运行后端测试，确认 profile 路由已通过**

Run: `node --import tsx --test src/server/index.test.ts`  
Expected: PASS，新增的 3 个 profile 用例通过，原有接口用例继续通过

- [ ] **Step 6: Commit**

```bash
git add src/server/jmClient.ts src/server/index.ts src/server/index.test.ts
git commit -m "feat: add hono jm profile endpoint"
```

---

### Task 3: 新增 Remix RPC，并让 `/me` loader 并行读取 profile

**Files:**
- Modify: `app/lib/jm-rpc.server.ts`
- Modify: `app/routes/me.tsx`

- [ ] **Step 1: 在 `app/routes/me.tsx` 写失败测试或最小可测 helper 断言之前，先定义 profile state 目标 shape**

将下面类型加入路由计划中：

```ts
type ProfileState = {
  isLoggedIn: boolean;
  profile: Profile | null;
  authMessage: string;
  error: string | null;
};
```

- [ ] **Step 2: 在 `app/lib/jm-rpc.server.ts` 新增 RPC 封装**

```ts
import {
  profileResultSchema,
  type Profile,
  type ProfileResult,
} from "../../src/shared/schema";

export async function fetchProfile(request: Request): Promise<ProfileResult> {
  const apiOrigin = getApiOrigin(request);
  const response = await fetch(`${apiOrigin}/api/profile`, {
    headers: createForwardHeaders(request),
  });
  return parseRpcResponse(response, profileResultSchema, "获取用户资料失败");
}
```

- [ ] **Step 3: 在 `/me` loader 里并行读取资料**

```ts
type MePageData = {
  tab: ProfileTab;
  albumId: string | null;
  createdTaskId: string | null;
  favoritesState: Promise<FavoritesState>;
  profileState: Promise<ProfileState>;
  tasksState: Promise<TaskListState>;
};

return defer({
  tab,
  albumId,
  createdTaskId,
  favoritesState: loadFavoritesState(request),
  profileState: loadProfileState(request),
  tasksState: loadTaskListState(request),
});
```

- [ ] **Step 4: 新增 `loadProfileState()`，确保失败隔离**

```ts
async function loadProfileState(request: Request): Promise<ProfileState> {
  const hasSession = hasRequestCookie(request.headers.get("Cookie"), "aura_session");
  if (!hasSession) {
    return {
      isLoggedIn: false,
      profile: null,
      authMessage: "登录后可同步头像、等级、称号与签名。",
      error: null,
    };
  }

  try {
    return await fetchProfile(request);
  } catch (error) {
    return {
      isLoggedIn: false,
      profile: null,
      authMessage: "当前资料区没有同步成功。",
      error: getProfileErrorMessage(error, "资料同步失败，请稍后重试。"),
    };
  }
}
```

- [ ] **Step 5: 增加 profile retry 分支，避免和 favorites/tasks 互相影响**

```ts
if (url.searchParams.get("profile-retry") === "profile") {
  return json({ profileState: await loadProfileState(request) });
}
```

- [ ] **Step 6: 运行类型检查**

Run: `npm run -s typecheck`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/lib/jm-rpc.server.ts app/routes/me.tsx
git commit -m "feat: load jm profile in me route"
```

---

### Task 4: 更新“我的”页头像与资料展示，并补前端测试

**Files:**
- Modify: `app/components/profile.tsx`
- Modify: `app/components/profile.test.tsx`
- Modify: `app/routes/me.tsx`

- [ ] **Step 1: 在 `app/components/profile.test.tsx` 先写失败测试，锁定名称优先级与资料展示**

```tsx
test("ProfileWorkspace overview shows nickname, level and title when profile data exists", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="overview"
      albumId={null}
      createdTaskId={null}
      pendingIntent={null}
      favoritesState={{
        favorites: { total: 0, page_size: 20, page_count: 0, folder_list: [], list: [] } as FavoritesResult,
        isLoggedIn: true,
        authMessage: "收藏夹已连接",
        error: null,
      }}
      profileState={{
        isLoggedIn: true,
        authMessage: "资料已连接",
        error: null,
        profile: {
          username: "jm_user",
          nickname: "小鲸鱼",
          avatar: "https://cdn.example/avatar.jpg",
          level: "LV.12",
          title: "至尊会员",
          badge: null,
          signature: "漫读者",
        },
      }}
      tasksState={{ tasks: [], error: null }}
    />,
  );

  assert.match(markup, /小鲸鱼/);
  assert.match(markup, /LV\.12/);
  assert.match(markup, /至尊会员/);
  assert.match(markup, /漫读者/);
  assert.match(markup, /avatar\.jpg/);
});

test("ProfileWorkspace keeps favorites and tasks visible when profile fails", async () => {
  const markup = await renderWithRouter(
    <ProfileWorkspace
      tab="overview"
      albumId={null}
      createdTaskId={null}
      pendingIntent={null}
      favoritesState={{
        favorites: { total: 3, page_size: 20, page_count: 1, folder_list: [], list: [] } as FavoritesResult,
        isLoggedIn: true,
        authMessage: "收藏夹已连接",
        error: null,
      }}
      profileState={{
        isLoggedIn: false,
        authMessage: "资料区未同步",
        error: "资料同步失败，请稍后重试。",
        profile: null,
      }}
      tasksState={{ tasks: [], error: null }}
    />,
  );

  assert.match(markup, /资料同步失败/);
  assert.match(markup, /收藏夹/);
  assert.match(markup, /下载/);
});
```

- [ ] **Step 2: 运行前端测试，确认先失败**

Run: `node --import tsx --test app/components/profile.test.tsx`  
Expected: FAIL，`ProfileWorkspace` 还不接受 `profileState` 或文案不匹配

- [ ] **Step 3: 在 `app/routes/me.tsx` 把 `profileState` 传给 `ProfileWorkspace`**

```tsx
<ProfileWorkspace
  albumId={data.albumId}
  createdTaskId={data.createdTaskId}
  favoritesState={data.favoritesState}
  profileState={data.profileState}
  pendingIntent={pendingIntent}
  tab={data.tab}
  tasksState={data.tasksState}
/>
```

- [ ] **Step 4: 在 `app/components/profile.tsx` 扩展 props 与 overview hero 展示**

```tsx
type ProfileState = {
  isLoggedIn: boolean;
  profile: Profile | null;
  authMessage: string;
  error: string | null;
};

const profileName =
  props.profileState.profile?.nickname ??
  props.profileState.profile?.username ??
  (props.favoritesState.isLoggedIn ? "JM 用户" : "JM-Aura-Remix");

const profileTagline = [
  props.profileState.profile?.level,
  props.profileState.profile?.title,
].filter(Boolean).join(" · ") || (props.favoritesState.isLoggedIn ? "已连接 · 漫读者" : "登录后同步收藏与下载");
```

头像区最小实现：

```tsx
{props.profileState.profile?.avatar ? (
  <img
    className="profile-overview-card__avatar-image"
    src={props.profileState.profile.avatar}
    alt={`${profileName} 的头像`}
  />
) : (
  <div className="profile-overview-card__avatar" aria-hidden="true">
    {props.favoritesState.isLoggedIn ? "JM" : "A"}
  </div>
)}
```

签名与资料错误：

```tsx
{props.profileState.profile?.signature ? (
  <p className="profile-overview-card__signature">{props.profileState.profile.signature}</p>
) : null}

{props.profileState.error ? (
  <StatusPanel
    tone="error"
    title="资料区刷新失败"
    description={props.profileState.error}
    action={
      <button
        className="md-button md-button--primary"
        type="button"
        onClick={props.onRetryProfile}
        disabled={props.retryingProfile}
      >
        {props.retryingProfile ? "重试中..." : "重试资料区"}
      </button>
    }
  />
) : null}
```

- [ ] **Step 5: 给 profile 区加独立 retry fetcher**

```tsx
fetcher.load(`/me?tab=${props.tab}&profile-retry=profile&nonce=${Date.now()}`);
```

确保它只替换 `profileState`，而不是重拉整个页面。

- [ ] **Step 6: 运行前端测试与类型检查**

Run: `node --import tsx --test app/components/profile.test.tsx`  
Expected: PASS

Run: `npm run -s typecheck`  
Expected: PASS

- [ ] **Step 7: 运行关键回归测试**

Run:

```bash
node --import tsx --test src/server/index.test.ts app/components/profile.test.tsx
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/routes/me.tsx app/components/profile.tsx app/components/profile.test.tsx
git commit -m "feat: show jm profile in me page"
```

---

## 自检

### Spec coverage

- `GET /api/profile`：Task 1 + Task 2
- Python 原版字段映射：Task 2
- 我的页并行读取：Task 3
- 头像/等级/称号/签名展示：Task 4
- profile 失败不拖垮 favorites/tasks：Task 3 + Task 4

### Placeholder scan

- 无 `TBD` / `TODO`
- 每个任务都给了具体文件、命令和代码片段

### Type consistency

- 响应名统一使用 `profileResultSchema` / `ProfileResult`
- 前端状态统一使用 `profileState`
- 展示字段统一使用 `avatar`、`level`、`title`、`badge`、`signature`

