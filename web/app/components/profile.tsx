import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { Await, Form, Link, useFetcher } from "@remix-run/react";
import { Suspense, useEffect, useState } from "react";

import type { FavoritesResult, Profile } from "../../../packages/shared/src/schema";
import type { TaskSummary } from "../lib/jm-rpc.server";
import {
  formatTaskSummary,
  formatTaskTagList,
  getTaskDownloadState,
  mapTaskStatusTone,
} from "../lib/tasks";
import {
  ProfileCardSkeleton,
  ProfileTaskListSkeleton,
} from "./loading";
import { DocumentNavigationLink, EmptyPanel, SectionHeader, StatusPanel } from "./ui";

export type ProfileTab = "overview" | "favorites" | "tasks";
export type LoginSyncState = {
  phase: "idle" | "waiting" | "refreshing";
  message: string;
  completedAtMs?: number | null;
};

type LoginActionResult =
  | {
      intent: "login";
      ok: true;
      message: string;
      completedAtMs: number;
    }
  | {
      intent: "login";
      ok?: false;
      message: string;
    };

export function buildProfileRetryPath(
  target: "favorites" | "profile" | "tasks",
  nonce: number,
): string {
  return `/me?index&profile-retry=${target}&nonce=${nonce}`;
}

/**
 * 强制触发「文档级」表单提交（整页跳转），绕开 fetcher/SPA 提交流程。
 * 主要用于修复部分环境下点击 submit 按钮不触发提交的问题。
 */
export function requestButtonFormSubmit(
  event: Pick<ReactMouseEvent<HTMLButtonElement>, "preventDefault" | "currentTarget">,
) {
  event.preventDefault();
  const form = event.currentTarget.form;
  if (!form) return;
  if (typeof form.reportValidity === "function" && !form.reportValidity()) {
    return;
  }
  form.submit();
}

function isLoginSyncActive(state: LoginSyncState | null | undefined): boolean {
  return Boolean(state && state.phase !== "idle");
}

export function getEffectiveLoginSyncState(args: {
  active: LoginSyncState | null;
  incoming: LoginSyncState | null;
  handledAtMs: number | null;
}): LoginSyncState | null {
  if (args.active) {
    return args.active;
  }

  if (!args.incoming) {
    return null;
  }

  if (!args.incoming.completedAtMs) {
    return args.incoming;
  }

  if (args.handledAtMs && args.incoming.completedAtMs === args.handledAtMs) {
    return null;
  }

  return args.incoming;
}

export function isProfileAuthRequiredError(message: string | null | undefined): boolean {
  const normalized = message?.trim();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("401") ||
    normalized.includes("請先登入會員") ||
    normalized.includes("Not legal.user")
  );
}

type ProfileWorkspaceProps = {
  tab: ProfileTab;
  favoritesState:
    | Promise<{
        favorites: FavoritesResult | null;
        isLoggedIn: boolean;
        authMessage: string;
        error: string | null;
      }>
    | {
        favorites: FavoritesResult | null;
        isLoggedIn: boolean;
        authMessage: string;
        error: string | null;
      };
  profileState:
    | Promise<{
        isLoggedIn: boolean;
        profile: Profile | null;
        authMessage: string;
        error: string | null;
      }>
    | {
        isLoggedIn: boolean;
        profile: Profile | null;
        authMessage: string;
        error: string | null;
      };
  tasksState:
    | Promise<{
        tasks: TaskSummary[];
        error: string | null;
      }>
    | {
        tasks: TaskSummary[];
        error: string | null;
      };
  pendingIntent?: "login" | "logout" | "export_favorites" | null;
  loginSyncState?: LoginSyncState | null;
  albumId?: string | null;
  createdTaskId?: string | null;
};

type ResolvedFavoritesState = Awaited<ProfileWorkspaceProps["favoritesState"]>;
type ResolvedProfileState = Awaited<ProfileWorkspaceProps["profileState"]>;
type ResolvedTasksState = Awaited<ProfileWorkspaceProps["tasksState"]>;

type ProfileRetryData = Partial<{
  favoritesState: ResolvedFavoritesState;
  profileState: ResolvedProfileState;
  tasksState: ResolvedTasksState;
}>;

export function ProfileWorkspace(props: ProfileWorkspaceProps) {
  const loginFetcher = useFetcher<LoginActionResult>();
  const favoritesSyncFetcher = useFetcher<ProfileRetryData>();
  const profileSyncFetcher = useFetcher<ProfileRetryData>();
  const tasksSyncFetcher = useFetcher<ProfileRetryData>();
  const [handledLoginSyncAt, setHandledLoginSyncAt] = useState<number | null>(null);
  const [activeLoginSyncState, setActiveLoginSyncState] = useState<LoginSyncState | null>(null);
  const resolvedFavoritesState = favoritesSyncFetcher.data?.favoritesState ?? props.favoritesState;
  const resolvedProfileState = profileSyncFetcher.data?.profileState ?? props.profileState;
  const resolvedTasksState = tasksSyncFetcher.data?.tasksState ?? props.tasksState;
  const effectiveLoginSyncState = getEffectiveLoginSyncState({
    active: activeLoginSyncState,
    incoming: props.loginSyncState ?? null,
    handledAtMs: handledLoginSyncAt,
  });
  const loginSubmitting = typeof window === "undefined" ? false : loginFetcher.state !== "idle";
  const workspaceSyncPending =
    favoritesSyncFetcher.state !== "idle" ||
    profileSyncFetcher.state !== "idle" ||
    tasksSyncFetcher.state !== "idle";

  useEffect(() => {
    if (loginFetcher.data?.intent !== "login" || loginFetcher.data.ok !== true) {
      return;
    }

    const completedAtMs = loginFetcher.data.completedAtMs;
    const message = loginFetcher.data.message;

    if (completedAtMs === handledLoginSyncAt) {
      return;
    }

    setHandledLoginSyncAt(completedAtMs);
    setActiveLoginSyncState({
      phase: "waiting",
      message,
      completedAtMs,
    });

    const timer = window.setTimeout(() => {
      const nonce = Date.now();
      favoritesSyncFetcher.load(buildProfileRetryPath("favorites", nonce));
      profileSyncFetcher.load(buildProfileRetryPath("profile", nonce));
      tasksSyncFetcher.load(buildProfileRetryPath("tasks", nonce));
      setActiveLoginSyncState({
        phase: "refreshing",
        message,
        completedAtMs,
      });
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [
    favoritesSyncFetcher,
    handledLoginSyncAt,
    loginFetcher.data,
    profileSyncFetcher,
    props.tab,
    tasksSyncFetcher,
  ]);

  useEffect(() => {
    if (!props.loginSyncState) {
      return;
    }

    if (props.loginSyncState.phase === "idle") {
      return;
    }

    if (!props.loginSyncState.completedAtMs || props.loginSyncState.completedAtMs === handledLoginSyncAt) {
      return;
    }

    setHandledLoginSyncAt(props.loginSyncState.completedAtMs);
    setActiveLoginSyncState({
      phase: "waiting",
      message: props.loginSyncState.message,
      completedAtMs: props.loginSyncState.completedAtMs,
    });

    const timer = window.setTimeout(() => {
      const nonce = Date.now();
      favoritesSyncFetcher.load(buildProfileRetryPath("favorites", nonce));
      profileSyncFetcher.load(buildProfileRetryPath("profile", nonce));
      tasksSyncFetcher.load(buildProfileRetryPath("tasks", nonce));
      setActiveLoginSyncState({
        phase: "refreshing",
        message: props.loginSyncState?.message ?? "登录成功，正在同步资料...",
        completedAtMs: props.loginSyncState?.completedAtMs ?? null,
      });
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [
    favoritesSyncFetcher,
    handledLoginSyncAt,
    profileSyncFetcher,
    props.loginSyncState,
    props.tab,
    tasksSyncFetcher,
  ]);

  useEffect(() => {
    if (activeLoginSyncState?.phase !== "refreshing") {
      return;
    }

    if (workspaceSyncPending) {
      return;
    }

    setActiveLoginSyncState(null);
  }, [activeLoginSyncState, workspaceSyncPending]);

  const overviewHero = (
    <RetryableOverviewHeroSection
      key="profile-overview-hero"
      loginSyncState={effectiveLoginSyncState}
      loginPending={loginSubmitting || isLoginSyncActive(effectiveLoginSyncState)}
      loginFetcher={loginFetcher}
      pendingIntent={props.pendingIntent}
      resolveFavorites={resolvedFavoritesState}
      resolveProfile={resolvedProfileState}
      tab={props.tab}
    />
  );

  const favoritesPage = (
    <RetryableFavoritesStateSection
      key="profile-favorites-state"
      loginSyncState={effectiveLoginSyncState}
      loginPending={loginSubmitting || isLoginSyncActive(effectiveLoginSyncState)}
      loginFetcher={loginFetcher}
      pendingIntent={props.pendingIntent}
      resolve={resolvedFavoritesState}
      tab={props.tab}
    />
  );

  const tasks = (
    <RetryableTaskListSection
      albumId={props.albumId}
      createdTaskId={props.createdTaskId}
      key="profile-tasks-state"
      resolve={resolvedTasksState}
      tab={props.tab}
    />
  );

  const sections =
    props.tab === "favorites" ? [favoritesPage] : props.tab === "tasks" ? [tasks] : [];

  return (
    <div className="profile-workspace">
      {overviewHero}
      {sections.length > 0 ? <div className="profile-workspace__pages">{sections}</div> : null}
    </div>
  );
}

function RetryableOverviewHeroSection(props: {
  resolveFavorites: ProfileWorkspaceProps["favoritesState"];
  resolveProfile: ProfileWorkspaceProps["profileState"];
  pendingIntent?: "login" | "logout" | "export_favorites" | null;
  loginSyncState?: LoginSyncState | null;
  loginPending: boolean;
  loginFetcher: ReturnType<typeof useFetcher<LoginActionResult>>;
  tab: ProfileTab;
}) {
  const favoritesFetcher = useFetcher<ProfileRetryData>();
  const profileFetcher = useFetcher<ProfileRetryData>();
  const retryingFavorites = favoritesFetcher.state !== "idle";
  const retryingProfile = profileFetcher.state !== "idle";
  const resolvedFavorites = favoritesFetcher.data?.favoritesState ?? props.resolveFavorites;
  const resolvedProfile = profileFetcher.data?.profileState ?? props.resolveProfile;

  if (retryingFavorites) {
    return (
      <ProfileCardSkeleton
        eyebrow="我的"
        title="正在同步工作区"
        rows={4}
      />
    );
  }

  return (
    <Suspense fallback={<ProfileCardSkeleton eyebrow="我的" title="正在同步工作区" rows={4} />}>
      <Await resolve={Promise.all([Promise.resolve(resolvedFavorites), Promise.resolve(resolvedProfile)])}>
        {([favoritesState, profileState]: [ResolvedFavoritesState, ResolvedProfileState]) => (
          <ProfileOverviewHero
            favoritesState={favoritesState}
            onRetryFavorites={() =>
              favoritesFetcher.load(buildProfileRetryPath("favorites", Date.now()))
            }
            onRetryProfile={() =>
              profileFetcher.load(buildProfileRetryPath("profile", Date.now()))
            }
            loginSyncState={props.loginSyncState}
            loginFetcher={props.loginFetcher}
            loginPending={props.loginPending}
            pendingIntent={props.pendingIntent}
            profileState={profileState}
            retryingFavorites={retryingFavorites}
            retryingProfile={retryingProfile}
          />
        )}
      </Await>
    </Suspense>
  );
}

function RetryableFavoritesStateSection(props: {
  resolve: ProfileWorkspaceProps["favoritesState"];
  pendingIntent?: "login" | "logout" | "export_favorites" | null;
  loginSyncState?: LoginSyncState | null;
  loginPending: boolean;
  loginFetcher: ReturnType<typeof useFetcher<LoginActionResult>>;
  tab: ProfileTab;
}) {
  const fetcher = useFetcher<ProfileRetryData>();
  const retrying = fetcher.state !== "idle";
  const resolved = fetcher.data?.favoritesState ?? props.resolve;

  if (retrying) {
    return (
      <ProfileFavoritesStateSkeleton showPendingExport={props.pendingIntent === "export_favorites"} />
    );
  }

  return (
    <Suspense
      fallback={<ProfileFavoritesStateSkeleton showPendingExport={props.pendingIntent === "export_favorites"} />}
    >
      <Await resolve={Promise.resolve(resolved)}>
        {(favoritesState: ResolvedFavoritesState) => (
          <ProfileFavoritesStateCards
            favoritesState={favoritesState}
            loginFetcher={props.loginFetcher}
            loginPending={props.loginPending}
            onRetry={() =>
              fetcher.load(buildProfileRetryPath("favorites", Date.now()))
            }
            loginSyncState={props.loginSyncState}
            pendingIntent={props.pendingIntent}
            retrying={retrying}
          />
        )}
      </Await>
    </Suspense>
  );
}

function RetryableTaskListSection(props: {
  resolve: ProfileWorkspaceProps["tasksState"];
  tab: ProfileTab;
  albumId?: string | null;
  createdTaskId?: string | null;
}) {
  const fetcher = useFetcher<ProfileRetryData>();
  const retrying = fetcher.state !== "idle";
  const resolved = fetcher.data?.tasksState ?? props.resolve;

  if (retrying) {
    return <ProfileTaskListSkeleton />;
  }

  return (
    <Suspense fallback={<ProfileTaskListSkeleton />}>
      <Await resolve={Promise.resolve(resolved)}>
        {(tasksState: ResolvedTasksState) => (
          <TaskListCard
            albumId={props.albumId}
            createdTaskId={props.createdTaskId}
            loadError={tasksState.error}
            onRetry={() =>
              fetcher.load(buildProfileRetryPath("tasks", Date.now()))
            }
            retrying={retrying}
            tasks={tasksState.tasks}
          />
        )}
      </Await>
    </Suspense>
  );
}

function ProfileFavoritesStateCards(props: {
  favoritesState: ResolvedFavoritesState;
  pendingIntent?: "login" | "logout" | "export_favorites" | null;
  loginSyncState?: LoginSyncState | null;
  loginFetcher: ReturnType<typeof useFetcher<LoginActionResult>>;
  loginPending: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const favoritesCard = (
    <FavoritesOverviewCard
      key="favorites"
      favorites={props.favoritesState.favorites}
      isLoggedIn={props.favoritesState.isLoggedIn}
      loadError={props.favoritesState.error}
      onRetry={props.onRetry}
      pending={props.pendingIntent === "export_favorites"}
      retrying={props.retrying}
    />
  );

  return (
    <>
      {favoritesCard}
    </>
  );
}

function ProfileFavoritesStateSkeleton(props: {
  showPendingExport: boolean;
}) {
  const favoritesCard = (
    <ProfileCardSkeleton
      key="favorites"
      chips={3}
      eyebrow="收藏夹概览"
      title="正在同步收藏夹概览"
      rows={props.showPendingExport ? 4 : 3}
      showAction
    />
  );

  return (
    <>
      {favoritesCard}
    </>
  );
}

function ProfileOverviewHero(props: {
  favoritesState: ResolvedFavoritesState;
  profileState: ResolvedProfileState;
  pendingIntent?: "login" | "logout" | "export_favorites" | null;
  loginSyncState?: LoginSyncState | null;
  loginFetcher: ReturnType<typeof useFetcher<LoginActionResult>>;
  loginPending: boolean;
  onRetryFavorites: () => void;
  onRetryProfile: () => void;
  retryingFavorites: boolean;
  retryingProfile: boolean;
}) {
  const profileName =
    getDisplayProfileValue(props.profileState.profile?.nickname) ??
    getDisplayProfileValue(props.profileState.profile?.username) ??
    "JM 用户";
  const profileTagline =
    [
      getDisplayProfileValue(props.profileState.profile?.level),
      getDisplayProfileValue(props.profileState.profile?.title),
    ]
      .filter(Boolean)
      .join(" · ") || (props.favoritesState.isLoggedIn ? "已连接 · 漫读者" : "登录后同步收藏与下载");
  const profileSignature = getDisplayProfileValue(props.profileState.profile?.signature);
  const avatarUrl = getDisplayProfileValue(props.profileState.profile?.avatar);
  const authErrorMessage = [props.favoritesState.error, props.profileState.error].find((message) =>
    isProfileAuthRequiredError(message),
  );
  const authRequired = Boolean(authErrorMessage);

  return (
    <section className="md-card profile-overview-card">
      <div className="profile-overview-card__head">
        {avatarUrl ? (
          <img
            className="profile-overview-card__avatar-image"
            src={avatarUrl}
            alt={`${profileName} 的头像`}
          />
        ) : (
          <div className="profile-overview-card__avatar" aria-hidden="true">
            {getProfileAvatarFallback(profileName)}
          </div>
        )}
        <div className="profile-overview-card__copy">
          <h1 className="profile-overview-card__name">{profileName}</h1>
          <p className="profile-overview-card__meta">{profileTagline}</p>
          {profileSignature ? (
            <p className="profile-overview-card__signature">{profileSignature}</p>
          ) : null}
        </div>
        {props.favoritesState.isLoggedIn && !authRequired ? (
          <Form reloadDocument method="post" action="/me?index" className="profile-overview-card__logout">
            <input type="hidden" name="intent" value="logout" />
            <button
              className="md-button md-button--outlined"
              type="submit"
              disabled={props.pendingIntent === "logout"}
              onClick={requestButtonFormSubmit}
            >
              {props.pendingIntent === "logout" ? "登出中..." : "登出"}
            </button>
          </Form>
        ) : null}
      </div>

      {props.favoritesState.error && !authRequired ? (
        <StatusPanel
          tone="error"
          title="工作区刷新失败"
          description={props.favoritesState.error}
          action={
            <button
              className="md-button md-button--primary"
              type="button"
              onClick={props.onRetryFavorites}
              disabled={props.retryingFavorites}
            >
              {props.retryingFavorites ? "重试中..." : "重试"}
            </button>
          }
        />
      ) : !props.favoritesState.isLoggedIn || authRequired ? (
        <Form reloadDocument method="post" action="/me?index" className="profile-overview-card__login-form">
          <input type="hidden" name="intent" value="login" />
          <input type="hidden" name="redirectTo" value="/me" />
          <label className="profile-overview-card__field">
            <span>用户名</span>
            <input className="md-input" name="username" type="text" required placeholder="输入 JM 用户名" style={inputStyle} />
          </label>
          <label className="profile-overview-card__field">
            <span>密码</span>
            <input className="md-input" name="password" type="password" required placeholder="输入密码" style={inputStyle} />
          </label>
          <button
            className="md-button md-button--primary md-button--with-spinner"
            type="submit"
            disabled={props.loginPending}
            onClick={requestButtonFormSubmit}
          >
            {props.loginPending ? (
              <>
                <span className="material-symbols-rounded md-button__spinner" aria-hidden="true">
                  progress_activity
                </span>
                <span>登录中...</span>
              </>
            ) : (
              "登录并同步"
            )}
          </button>
          {isLoginSyncActive(props.loginSyncState) ? (
            <p className="profile-overview-card__sync-hint">{props.loginSyncState?.message}</p>
          ) : null}
          {authErrorMessage ? (
            <p className="profile-overview-card__sync-hint">{authErrorMessage}，即将切换到登录界面。</p>
          ) : null}
        </Form>
      ) : null}

      {props.profileState.error && !authRequired ? (
        <div
          className="profile-overview-card__profile-error"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "12px",
            padding: "14px 16px",
            borderRadius: "16px",
            background: "color-mix(in srgb, var(--md-sys-color-error-container) 48%, transparent)",
            color: "var(--md-sys-color-on-error-container)",
          }}
        >
          <span>资料区刷新失败：{props.profileState.error}</span>
          <button
            className="md-button md-button--surface"
            type="button"
            onClick={props.onRetryProfile}
            disabled={props.retryingProfile}
          >
            {props.retryingProfile ? "重试中..." : "重试资料区"}
          </button>
        </div>
      ) : null}

      <nav className="profile-overview-card__actions" aria-label="我的页导航">
        <DocumentNavigationLink className="md-button md-button--primary" to="/me/favorites">
          去收藏夹
        </DocumentNavigationLink>
        <DocumentNavigationLink className="md-button md-button--surface" to="/me/tasks">
          去看下载
        </DocumentNavigationLink>
      </nav>
    </section>
  );
}

export function LoginCard(props: {
  isLoggedIn: boolean;
  authMessage: string;
  redirectTo: string;
  pending?: boolean;
  loginSyncState?: LoginSyncState | null;
  loginFetcher?: ReturnType<typeof useFetcher<LoginActionResult>>;
  loginPending?: boolean;
  logoutPending?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const LoginForm = props.loginFetcher?.Form ?? Form;
  const effectiveLoginPending = props.loginPending ?? props.pending;

  return (
    <section
      className="md-card"
      style={{ padding: "24px", display: "grid", gap: "20px", background: "var(--md-sys-color-surface-container-low)" }}
    >
      <SectionHeader
        eyebrow="登录状态"
        title={props.isLoggedIn ? "当前会话已连接" : "登录后同步收藏与下载"}
        description={props.authMessage}
      />

      {props.loadError ? (
        <StatusPanel
          tone="error"
          title="登录状态刷新失败"
          description="当前区块没有同步成功。"
          action={
            <button
              className="md-button md-button--primary"
              type="button"
              onClick={props.onRetry}
              disabled={props.retrying}
            >
              {props.retrying ? "重试中..." : "重试当前区块"}
            </button>
          }
        />
      ) : props.isLoggedIn ? (
        <StatusPanel
          tone="success"
          title="已连接当前账号会话"
          description="现在可以查看收藏夹、发起收藏夹下载，并在列表里持续追踪下载状态。"
          action={
            <Form reloadDocument method="post" action="/me?index">
              <input type="hidden" name="intent" value="logout" />
              <button
                className="md-button md-button--outlined"
                type="submit"
                disabled={props.logoutPending}
                onClick={requestButtonFormSubmit}
              >
                {props.logoutPending ? "登出中..." : "登出"}
              </button>
            </Form>
          }
        />
      ) : (
        <LoginForm
          reloadDocument
          method="post"
          action="/me?index"
          style={{ display: "grid", gap: "12px", maxWidth: "480px" }}
        >
          <input type="hidden" name="intent" value="login" />
          <input type="hidden" name="redirectTo" value={props.redirectTo} />
          <label style={{ display: "grid", gap: "8px" }}>
            <span>用户名</span>
            <input
              className="md-input"
              name="username"
              type="text"
              required
              placeholder="输入 JM 用户名"
              style={inputStyle}
            />
          </label>
          <label style={{ display: "grid", gap: "8px" }}>
            <span>密码</span>
            <input
              className="md-input"
              name="password"
              type="password"
              required
              placeholder="输入密码"
              style={inputStyle}
            />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
            <button
              className="md-button md-button--primary md-button--with-spinner"
              type="submit"
              disabled={effectiveLoginPending}
              onClick={requestButtonFormSubmit}
            >
              {effectiveLoginPending ? (
                <>
                  <span className="material-symbols-rounded md-button__spinner" aria-hidden="true">
                    progress_activity
                  </span>
                  <span>登录中...</span>
                </>
              ) : (
                "登录并同步收藏"
              )}
            </button>
            <Link className="md-button md-button--surface" prefetch="intent" to="/search">
              先去找作品
            </Link>
          </div>
          {isLoginSyncActive(props.loginSyncState) ? (
            <p className="profile-overview-card__sync-hint">{props.loginSyncState?.message}</p>
          ) : null}
        </LoginForm>
      )}
    </section>
  );
}

export function FavoritesOverviewCard(props: {
  isLoggedIn: boolean;
  favorites: FavoritesResult | null;
  pending?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const previewItems = props.favorites?.list.slice(0, 4) ?? [];

  return (
    <section
      className="md-card"
      style={{ padding: "24px", display: "grid", gap: "20px", background: "var(--md-sys-color-surface-container-low)" }}
    >
      <SectionHeader
        eyebrow="收藏夹概览"
        title={props.isLoggedIn ? `已收藏 ${props.favorites?.total ?? 0} 部作品` : "登录后查看收藏夹"}
        description={
          props.isLoggedIn
            ? "收藏页会优先给出总量、常用文件夹和最近收藏作品。"
            : "未登录时无法同步收藏夹，也无法直接发起收藏夹下载。"
        }
        action={
          props.isLoggedIn ? (
            <Form method="post">
              <input type="hidden" name="intent" value="export_favorites" />
              <button
                className="md-button md-button--tonal"
                type="submit"
                disabled={props.pending}
              >
                {props.pending ? "正在创建任务..." : "下载收藏夹"}
              </button>
            </Form>
          ) : null
        }
      />

      {props.loadError ? (
        <StatusPanel
          tone="error"
          title="收藏夹概览刷新失败"
          description="当前区块没有同步成功。"
          action={
            <button
              className="md-button md-button--primary"
              type="button"
              onClick={props.onRetry}
              disabled={props.retrying}
            >
              {props.retrying ? "重试中..." : "重试当前区块"}
            </button>
          }
        />
      ) : props.isLoggedIn && props.favorites ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
            <span className="md-chip">总数 {props.favorites.total}</span>
            <span className="md-chip">文件夹 {props.favorites.folder_list.length}</span>
            <span className="md-chip">页数 {props.favorites.page_count}</span>
          </div>

          {previewItems.length > 0 ? (
            <div style={{ display: "grid", gap: "12px" }}>
              {previewItems.map((item) => (
                <DocumentNavigationLink
                  key={item.id}
                  className="md-card"
                  to={`/manga/${item.id}`}
                  style={{
                    display: "grid",
                    gap: "6px",
                    padding: "16px 18px",
                    background: "var(--md-sys-color-surface-container)",
                  }}
                >
                  <strong style={{ font: "var(--md-sys-typescale-title-medium)" }}>{item.name}</strong>
                  <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
                    {item.author || "未知作者"}
                    {item.latest_ep ? ` · 最新 ${item.latest_ep}` : ""}
                  </span>
                </DocumentNavigationLink>
              ))}
            </div>
          ) : (
            <EmptyPanel
              title="收藏夹还是空的"
              description="先去详情页收藏作品，之后这里会显示概览并支持一键下载。"
            />
          )}
        </>
      ) : (
        <EmptyPanel
          title="尚未连接收藏夹"
          description="完成登录后，这里会展示收藏总量、预览列表和下载入口。"
        />
      )}
    </section>
  );
}

export function TaskListCard(props: {
  tasks: TaskSummary[];
  albumId?: string | null;
  createdTaskId?: string | null;
  loadError?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const tasks = [...props.tasks].sort((left, right) => right.createdAt - left.createdAt);

  return (
    <section
      className="md-card"
      style={{ padding: "24px", display: "grid", gap: "20px", background: "var(--md-sys-color-surface-container-low)" }}
    >
      <SectionHeader
        eyebrow="下载"
        title="下载列表、入口与过期提示"
        description="成功任务会给出下载入口；如果文件过期或任务失败，请重新发起下载。"
      />

      {props.createdTaskId ? (
        <StatusPanel
          tone="accent"
          title="新任务已加入队列"
          description="下载已经开始执行，完成后这张卡片会切换为可保存状态。"
        />
      ) : null}

      {props.albumId ? (
        <StatusPanel
          tone="accent"
          title="已落到任务页"
          description="你是从作品详情跳转过来的。详情页负责发起作品下载，这里负责持续查看进度与下载结果。"
          action={
            <DocumentNavigationLink className="md-button md-button--surface" to={`/manga/${props.albumId}`}>
              返回作品详情
            </DocumentNavigationLink>
          }
        />
      ) : null}

      {props.loadError ? (
        <StatusPanel
          tone="error"
          title="任务列表刷新失败"
          description="当前区块没有同步成功。"
          action={
            <button
              className="md-button md-button--primary"
              type="button"
              onClick={props.onRetry}
              disabled={props.retrying}
            >
              {props.retrying ? "重试中..." : "重试当前区块"}
            </button>
          }
        />
      ) : tasks.length === 0 ? (
        <EmptyPanel
          title="还没有下载记录"
          description="从收藏夹概览或作品详情发起下载后，进度会在这里持续更新。"
        />
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {tasks.map((task) => {
            const tone = mapTaskStatusTone(task.status);
            const download = getTaskDownloadState(task);
            const highlighted = props.createdTaskId === task.id;

            return (
              <article
                key={task.id}
                className="md-card"
                style={{
                  display: "grid",
                  gap: "14px",
                  padding: "18px",
                  border: highlighted
                    ? "1px solid color-mix(in srgb, var(--md-sys-color-primary) 56%, transparent)"
                    : undefined,
                  background:
                    tone === "error"
                      ? "color-mix(in srgb, var(--md-sys-color-error-container) 38%, var(--md-sys-color-surface-container))"
                      : tone === "success"
                        ? "color-mix(in srgb, var(--md-sys-color-tertiary-container) 38%, var(--md-sys-color-surface-container))"
                        : "var(--md-sys-color-surface-container)",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {formatTaskTagList(task).map((tag) => (
                    <span className="md-chip" key={`${task.id}-${tag}`}>
                      {tag}
                    </span>
                  ))}
                </div>

                <div style={{ display: "grid", gap: "6px" }}>
                  <strong style={{ font: "var(--md-sys-typescale-title-medium)" }}>
                    {formatTaskSummary(task)}
                  </strong>
                  <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
                    任务 ID：{task.id}
                  </span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
                  {download.href ? (
                    <a className="md-button md-button--primary" href={download.href}>
                      {download.label}
                    </a>
                  ) : (
                    <span className="md-button md-button--surface" aria-disabled="true">
                      {download.label}
                    </span>
                  )}
                  <span style={{ color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.6 }}>
                    {download.hint}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

const inputStyle = {
  minHeight: "48px",
  borderRadius: "16px",
  border: "1px solid color-mix(in srgb, var(--md-sys-color-outline) 56%, transparent)",
  background: "var(--md-sys-color-surface)",
  padding: "0 16px",
} satisfies CSSProperties;

function getDisplayProfileValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getProfileAvatarFallback(profileName: string) {
  const normalized = profileName.trim();
  if (!normalized) {
    return "J";
  }

  const first = normalized[0];
  return /[a-z0-9]/i.test(first) ? first.toUpperCase() : first;
}
