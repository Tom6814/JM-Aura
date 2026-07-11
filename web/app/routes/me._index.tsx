import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import type { FavoritesResult, Profile } from "../../../packages/shared/src/schema";
import { ProfileWorkspace } from "../components/profile";
import { DocumentNavigationLink, StatusPanel } from "../components/ui";
import { fetchFavorites, fetchProfile, loginUser, logoutUser } from "../lib/jm-rpc.server";
import { FAVORITES_PAGE_SIZE_OPTIONS, normalizeFavoritesPageSize } from "../lib/me-settings";
import { getFavoritesPageSize, setFavoritesPageSize } from "../lib/me-settings.server";
import { hasRequestCookie } from "../lib/request-cookie";

type FavoritesState = {
  favorites: FavoritesResult | null;
  isLoggedIn: boolean;
  authMessage: string;
  error: string | null;
};

type ProfileState = {
  isLoggedIn: boolean;
  profile: Profile | null;
  authMessage: string;
  error: string | null;
};

type TaskListState = {
  tasks: [];
  error: string | null;
};

type MePageData = {
  favoritesState: Promise<FavoritesState>;
  profileState: Promise<ProfileState>;
  tasksState: Promise<TaskListState>;
  favoritesPageSize: number;
};

type MeActionData =
  | {
      intent: "login";
      ok: true;
      message: string;
      completedAtMs: number;
    }
  | {
      intent: string;
      ok?: false;
      message: string;
    };

export const meta: MetaFunction = () => [{ title: "我的 | JM Aura Remix" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const favoritesPageSize = await getFavoritesPageSize(request);

  if (url.searchParams.get("profile-retry") === "favorites") {
    return json({ favoritesState: await loadFavoritesState(request) });
  }

  if (url.searchParams.get("profile-retry") === "profile") {
    return json({ profileState: await loadProfileState(request) });
  }

  const [favoritesState, profileState] = await Promise.all([
    loadFavoritesState(request),
    loadProfileState(request),
  ]);

  return json({
    favoritesState,
    profileState,
    tasksState: { tasks: [], error: null },
    favoritesPageSize,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "set_favorites_page_size") {
    const pageSize = normalizeFavoritesPageSize(formData.get("page_size"));
    const headers = new Headers();
    await setFavoritesPageSize(headers, pageSize);
    return redirect("/me", { headers });
  }

  if (intent === "login") {
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();
    const redirectTo = normalizeRedirectTo(formData.get("redirectTo"), "/me");

    if (!username || !password) {
      return json(
        {
          intent,
          message: "请输入完整的用户名和密码。",
        },
        { status: 400 },
      );
    }

    try {
      const result = await loginUser(request, username, password);
      const headers = new Headers();

      if (result.sessionCookie) {
        headers.append("Set-Cookie", result.sessionCookie);
      }
      return redirect(redirectTo, { headers });
    } catch (error) {
      return json(
        {
          intent,
          ok: false,
          message: error instanceof Error ? error.message : "登录失败，请稍后重试。",
        },
        { status: 400 },
      );
    }
  }

  if (intent === "logout") {
    try {
      const result = await logoutUser(request);
      const headers = new Headers();
      if (result.sessionCookie) {
        headers.append("Set-Cookie", result.sessionCookie);
      }
      return redirect("/me", { headers });
    } catch (error) {
      return json(
        {
          intent,
          ok: false,
          message: error instanceof Error ? error.message : "登出失败，请稍后重试。",
        },
        { status: 400 },
      );
    }
  }

  return json(
    {
      intent,
      ok: false,
      message: "暂不支持的我的页操作。",
    },
    { status: 400 },
  );
}

export default function MeIndexRoute() {
  const data = useLoaderData<typeof loader>() as unknown as MePageData;
  const actionData = useActionData<typeof action>() as MeActionData | undefined;
  const navigation = useNavigation();
  const pendingIntent = normalizePendingIntent(
    navigation.formData ? String(navigation.formData.get("intent") ?? "") : null,
  );

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      {actionData && !actionData.ok ? (
        <StatusPanel
          tone="error"
          title={actionData.intent === "login" ? "登录未完成" : "操作未完成"}
          description={actionData.message}
        />
      ) : null}

      <ProfileWorkspace
        albumId={null}
        createdTaskId={null}
        favoritesState={data.favoritesState}
        loginSyncState={null}
        profileState={data.profileState}
        pendingIntent={pendingIntent}
        tab="overview"
        tasksState={data.tasksState}
      />

      <section className="md-card" style={{ padding: "24px", display: "grid", gap: "16px" }}>
        <div style={{ display: "grid", gap: "6px" }}>
          <h2 style={{ margin: 0, font: "var(--md-sys-typescale-title-medium)" }}>设置</h2>
          <p
            style={{
              margin: 0,
              color: "var(--md-sys-color-on-surface-variant)",
              font: "var(--md-sys-typescale-body-medium)",
            }}
          >
            先提供收藏分页大小设置，后续再按需扩展。
          </p>
        </div>

        <Form method="post" action="/me?index" style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
          <input type="hidden" name="intent" value="set_favorites_page_size" />
          <label style={{ display: "grid", gap: "6px" }}>
            <span style={{ font: "var(--md-sys-typescale-body-small)", color: "var(--md-sys-color-on-surface-variant)" }}>
              收藏列表每页条数
            </span>
            <select name="page_size" defaultValue={String(data.favoritesPageSize)} className="md-input">
              {FAVORITES_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={String(size)}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button className="md-button md-button--primary" type="submit">
            保存
          </button>
          <DocumentNavigationLink className="md-button md-button--surface" to="/me/favorites">
            去收藏页
          </DocumentNavigationLink>
          <DocumentNavigationLink className="md-button md-button--surface" to="/me/tasks">
            去下载页
          </DocumentNavigationLink>
        </Form>
      </section>
    </div>
  );
}

async function loadFavoritesState(request: Request): Promise<FavoritesState> {
  const hasSession = hasRequestCookie(request.headers.get("Cookie"), "aura_session");

  if (!hasSession) {
    return {
      favorites: null,
      isLoggedIn: false,
      authMessage: "登录后可同步收藏夹并发起收藏夹下载。",
      error: null,
    };
  }

  try {
    const favoritesPageSize = await getFavoritesPageSize(request);
    const favorites = await fetchFavorites(request, { page_size: favoritesPageSize });
    const authMessage =
      favorites.total > 0
        ? `当前会话已同步 ${favorites.total} 项收藏，可以继续管理与导出。`
        : "当前会话已连接，收藏夹暂时为空。";

    return {
      favorites,
      isLoggedIn: true,
      authMessage,
      error: null,
    };
  } catch (error) {
    return {
      favorites: null,
      isLoggedIn: false,
      authMessage: `当前尚未连接收藏夹：${getProfileErrorMessage(
        error,
        "登录后可同步收藏夹并发起收藏夹下载。",
      )}`,
      error: getProfileErrorMessage(error, "登录状态同步失败，请稍后重试。"),
    };
  }
}

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

function normalizePendingIntent(input: string | null): "login" | "logout" | null {
  if (input === "login" || input === "logout") {
    return input;
  }

  return null;
}

function getProfileErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function normalizeRedirectTo(input: FormDataEntryValue | null, fallback: string): string {
  if (typeof input !== "string") {
    return fallback;
  }

  return input.startsWith("/me") ? input : fallback;
}
