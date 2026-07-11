import test from "node:test";
import assert from "node:assert/strict";

import app from "./index";
import { JMComicClient } from "./jmClient";

test("POST /api/favorites forwards folder_id when provided", async () => {
  const calls: Array<{
    path: string;
    options: {
      method?: "GET" | "POST";
      params?: Record<string, string | number>;
      form?: Record<string, string | number>;
    };
  }> = [];

  const originalRequestApi = JMComicClient.prototype.requestApi;
  JMComicClient.prototype.requestApi = async function requestApiMock(path, options = {}) {
    calls.push({ path, options });
    return {
      response: new Response(),
      envelope: { code: 200, data: "" },
      ts: "0",
      encoded_data: "",
      decoded_data: "{}",
      data: {} as never,
    };
  };

  try {
    const response = await app.request(
      new Request("http://localhost/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          album_id: "123456",
          folder_id: "42",
        }),
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.path, JMComicClient.API_FAVORITE);
    assert.deepEqual(calls[0]?.options.form, {
      aid: "123456",
      folder_id: "42",
    });
  } finally {
    JMComicClient.prototype.requestApi = originalRequestApi;
  }
});

test("GET /api/favorites supports custom page_size by slicing aggregated upstream pages", async () => {
  const calls: Array<{
    path: string;
    options: { params?: Record<string, string | number> };
  }> = [];

  const originalRequestApi = JMComicClient.prototype.requestApi;
  JMComicClient.prototype.requestApi = async function requestApiMock(path, options = {}) {
    calls.push({ path, options });
    const page = Number(options.params?.page ?? 1);
    const folderId = String(options.params?.folder_id ?? "0");

    // Build a stable 20-item page to simulate upstream FAVORITE_PAGE_SIZE=20
    const base = (page - 1) * 20;
    const content = Array.from({ length: 20 }, (_, index) => ({
      id: String(base + index + 1),
      name: `fav-${folderId}-${base + index + 1}`,
      latest_ep: null,
      latest_ep_aid: null,
      image: null,
      author: null,
    }));

    return {
      response: new Response(),
      envelope: { code: 200, data: "" },
      ts: "0",
      encoded_data: "",
      decoded_data: "{}",
      data: {
        total: "100",
        list: content,
        folder_list: [{ FID: "0", name: "默认" }],
      } as never,
    };
  };

  try {
    const response10 = await app.request(
      new Request("http://localhost/api/favorites?page=1&folder_id=0&order_by=mr&page_size=10"),
    );
    assert.equal(response10.status, 200);
    const json10 = (await response10.json()) as { list: Array<{ id: string }>; page_size: number; page_count: number };
    assert.equal(json10.page_size, 10);
    assert.equal(json10.list.length, 10);
    assert.equal(json10.list[0]?.id, "1");
    assert.equal(json10.page_count, 10);

    calls.length = 0;
    const response40 = await app.request(
      new Request("http://localhost/api/favorites?page=1&folder_id=0&order_by=mr&page_size=40"),
    );
    assert.equal(response40.status, 200);
    const json40 = (await response40.json()) as { list: Array<{ id: string }>; page_size: number };
    assert.equal(json40.page_size, 40);
    assert.equal(json40.list.length, 40);
    assert.deepEqual(
      calls.map((call) => call.options.params?.page),
      [1, 2],
    );
  } finally {
    JMComicClient.prototype.requestApi = originalRequestApi;
  }
});

test("GET /api/home aggregates latest plus today/week/month rankings", async () => {
  const calls: Array<{
    path: string;
    options: {
      method?: "GET" | "POST";
      params?: Record<string, string | number>;
      form?: Record<string, string | number>;
    };
  }> = [];

  const originalRequestApi = JMComicClient.prototype.requestApi;
  JMComicClient.prototype.requestApi = async function requestApiMock(path, options = {}) {
    calls.push({ path, options });

    const order = String(options.params?.o ?? "");
    const idByOrder: Record<string, string> = {
      mr: "100",
      mv_t: "101",
      mv_w: "102",
      mv_m: "103",
    };
    return {
      response: new Response(),
      envelope: { code: 200, data: "" },
      ts: "0",
      encoded_data: "",
      decoded_data: "{}",
      data: {
        total: "1",
        content: [
          {
            id: idByOrder[order] ?? "100",
            name: `feed-${order || "mr"}`,
            tag_list: ["tag"],
            author: "author",
            description: null,
            image: null,
          },
        ],
      } as never,
    };
  };

  try {
    const response = await app.request(new Request("http://localhost/api/home"));

    assert.equal(response.status, 200);
    const setCookie = response.headers.get("set-cookie");
    assert.ok(setCookie?.startsWith("aura_session="));
    const json = (await response.json()) as {
      latest: { content: Array<{ id: string }> };
      rankings: {
        today: { content: Array<{ id: string }> };
        week: { content: Array<{ id: string }> };
        month: { content: Array<{ id: string }> };
      };
    };

    assert.equal(calls.length, 4);
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/categories/filter", "/categories/filter", "/categories/filter", "/categories/filter"],
    );
    assert.deepEqual(
      calls.map((call) => call.options.params?.o),
      ["mr", "mv_t", "mv_w", "mv_m"],
    );

    assert.equal(json.latest.content[0]?.id, "100");
    assert.equal(json.rankings.today.content[0]?.id, "101");
    assert.equal(json.rankings.week.content[0]?.id, "102");
    assert.equal(json.rankings.month.content[0]?.id, "103");

    // When upstream returns null image, backend must construct a usable cover URL.
    const domain = new JMComicClient().getImageDomain();
    const expected = `https://${domain}/media/albums/100_3x4.jpg`;
    assert.equal((json as any).latest.content[0]?.image, expected);
  } finally {
    JMComicClient.prototype.requestApi = originalRequestApi;
  }
});

test("GET /api/manga/:id falls back to full cover when upstream image is null", async () => {
  const originalRequestApi = JMComicClient.prototype.requestApi;
  JMComicClient.prototype.requestApi = async function requestApiMock(path, options = {}) {
    if (path === JMComicClient.API_ALBUM) {
      return {
        response: new Response(),
        envelope: { code: 200, data: "" },
        ts: "0",
        encoded_data: "",
        decoded_data: "{}",
        data: {
          id: String(options.params?.id ?? "0"),
          scramble_id: "0",
          name: "album-name",
          image: null,
          description: "",
          page_count: "0",
          pub_date: "0",
          update_date: "0",
          likes: "0",
          views: "0",
          comment_total: "0",
          works: [],
          actors: [],
          author: ["author"],
          tags: ["tag"],
          series: [],
          related_list: [],
        } as never,
      };
    }

    throw new Error(`unexpected path: ${path}`);
  };

  try {
    const response = await app.request(new Request("http://localhost/api/manga/123456"));
    assert.equal(response.status, 200);
    const json = (await response.json()) as { image: string | null; album_id: string };
    assert.equal(json.album_id, "123456");

    const domain = new JMComicClient().getImageDomain();
    const expected = `https://${domain}/media/albums/123456.jpg`;
    assert.equal(json.image, expected);
  } finally {
    JMComicClient.prototype.requestApi = originalRequestApi;
  }
});

test("POST /api/logout clears JM client state but keeps device session id", async () => {
  const seenClients: unknown[] = [];

  const originalRequestApi = JMComicClient.prototype.requestApi;
  JMComicClient.prototype.requestApi = async function requestApiMock(_path, _options = {}) {
    seenClients.push(this);
    return {
      response: new Response(),
      envelope: { code: 200, data: "" },
      ts: "0",
      encoded_data: "",
      decoded_data: "{}",
      data: { total: "0", content: [] } as never,
    };
  };

  try {
    const first = await app.request(new Request("http://localhost/api/home"));
    assert.equal(first.status, 200);
    const cookie = first.headers.get("set-cookie");
    assert.ok(cookie?.startsWith("aura_session="));
    assert.ok(seenClients.length > 0);
    const client1 = seenClients[0];

    const logout = await app.request(
      new Request("http://localhost/api/logout", {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
        },
      }),
    );
    assert.equal(logout.status, 200);
    assert.equal(logout.headers.get("set-cookie"), null);

    // Same device session id should still be accepted, but JM client must be replaced.
    const beforeSecond = seenClients.length;
    const second = await app.request(
      new Request("http://localhost/api/home", {
        headers: {
          cookie: cookie ?? "",
        },
      }),
    );
    assert.equal(second.status, 200);
    assert.ok(seenClients.length > beforeSecond);
    const client2 = seenClients[beforeSecond];
    assert.notEqual(client2, client1);
  } finally {
    JMComicClient.prototype.requestApi = originalRequestApi;
  }
});

test("GET /api/comments returns normalized comment list and supports order", async () => {
  const originalRequestApi = JMComicClient.prototype.requestApi;
  JMComicClient.prototype.requestApi = async function requestApiMock(path, options = {}) {
    if (path === "/forum") {
      return {
        response: new Response(),
        envelope: { code: 200, data: "" },
        ts: "0",
        encoded_data: "",
        decoded_data: "{}",
        data: {
          total: "2",
          list: [
            {
              AID: String(options.params?.aid ?? "0"),
              CID: "1",
              username: "u1",
              nickname: "n1",
              likes: "3",
              addtime: "Jul 01, 2026",
              parent_CID: "0",
              content: "<div>hello</div>",
              photo: "nopic-Male.gif",
            },
            {
              AID: String(options.params?.aid ?? "0"),
              CID: "2",
              username: "u2",
              nickname: null,
              likes: "0",
              addtime: "Jul 02, 2026",
              parent_CID: "0",
              content: "<div style='flex-direction:row'>world</div>",
              photo: "nopic-Male.gif",
            },
          ],
        } as never,
      };
    }

    throw new Error(`unexpected path: ${path}`);
  };

  try {
    const response = await app.request(new Request("http://localhost/api/comments?album_id=123&page=1&order=desc"));
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("set-cookie")?.startsWith("aura_session="));

    const json = (await response.json()) as any;
    assert.equal(json.success, true);
    assert.equal(json.page, 1);
    assert.equal(json.total, 2);
    assert.deepEqual(
      json.comments.map((item: any) => item.id),
      ["2", "1"],
    );
    assert.equal(json.comments[0]?.user, "u2");
    assert.equal(json.comments[0]?.content, "world");
    assert.equal(json.comments[1]?.user, "n1");
    assert.equal(json.comments[1]?.content, "hello");
    assert.equal(json.comments[1]?.likes, 3);
  } finally {
    JMComicClient.prototype.requestApi = originalRequestApi;
  }
});

test("GET /api/comments returns 400 when album_id is missing", async () => {
  const response = await app.request(new Request("http://localhost/api/comments?page=1"));
  assert.equal(response.status, 400);
});

test("POST /api/categories forwards sub_category via Python-style category path", async () => {
  const calls: Array<{
    path: string;
    options: {
      method?: "GET" | "POST";
      params?: Record<string, string | number>;
      form?: Record<string, string | number>;
    };
  }> = [];

  const originalRequestApi = JMComicClient.prototype.requestApi;
  JMComicClient.prototype.requestApi = async function requestApiMock(path, options = {}) {
    calls.push({ path, options });
    return {
      response: new Response(),
      envelope: { code: 200, data: "" },
      ts: "0",
      encoded_data: "",
      decoded_data: "{}",
      data: {
        total: "0",
        content: [],
      } as never,
    };
  };

  try {
    const response = await app.request(
      new Request("http://localhost/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "doujin",
          sub_category: "CG",
          page: 1,
          order_by: "mv",
          time: "a",
        }),
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.path, "/categories/filter/doujin/sub/CG");
    assert.deepEqual(calls[0]?.options.params, {
      page: 1,
      order: "",
      c: "doujin",
      o: "mv",
    });
  } finally {
    JMComicClient.prototype.requestApi = originalRequestApi;
  }
});

test("GET /api/profile returns normalized profile fields", async () => {
  const originalGetCachedProfileSnapshot = (JMComicClient.prototype as any).getCachedProfileSnapshot;
  const originalFetchProfile = JMComicClient.prototype.fetchProfile;
  (JMComicClient.prototype as any).getCachedProfileSnapshot = function getCachedProfileSnapshotMock() {
    return {
      username: "jm_user",
      nickname: "小鲸鱼",
      photo: "https://cdn.example/avatar.jpg",
      level: "12",
      level_name: "至尊会员",
      badge_name: "年度徽章",
      signature: "漫读者",
    };
  };
  JMComicClient.prototype.fetchProfile = async function fetchProfileMock() {
    throw new Error("should not fetch profile upstream when cached login snapshot exists");
  };

  try {
    const response = await app.request(new Request("http://localhost/api/profile"));
    assert.equal(response.status, 200);
    const json = (await response.json()) as any;
    const avatarUrl = new URL(json.profile.avatar, "http://localhost");

    assert.equal(json.isLoggedIn, true);
    assert.equal(json.profile.nickname, "小鲸鱼");
    assert.equal(avatarUrl.pathname, "/api/image/proxy");
    assert.equal(avatarUrl.searchParams.get("decrypt"), "false");
    assert.equal(avatarUrl.searchParams.get("format"), "original");
    assert.equal(avatarUrl.searchParams.get("url"), "https://cdn.example/avatar.jpg");
    assert.equal(json.profile.level, "12");
    assert.equal(json.profile.title, "至尊会员");
    assert.equal(json.profile.badge, "年度徽章");
    assert.equal(json.profile.signature, "漫读者");
  } finally {
    (JMComicClient.prototype as any).getCachedProfileSnapshot = originalGetCachedProfileSnapshot;
    JMComicClient.prototype.fetchProfile = originalFetchProfile;
  }
});

test("GET /api/profile normalizes bare avatar filenames into proxied JM user image URLs", async () => {
  const originalGetCachedProfileSnapshot = (JMComicClient.prototype as any).getCachedProfileSnapshot;
  const originalFetchProfile = JMComicClient.prototype.fetchProfile;
  (JMComicClient.prototype as any).getCachedProfileSnapshot = function getCachedProfileSnapshotMock() {
    return {
      username: "jm_user",
      nickname: "小鲸鱼",
      photo: "20388553.jpg",
    };
  };
  JMComicClient.prototype.fetchProfile = async function fetchProfileMock() {
    throw new Error("should not fetch profile upstream when cached login snapshot exists");
  };

  try {
    const response = await app.request(new Request("http://localhost/api/profile"));
    assert.equal(response.status, 200);
    const json = (await response.json()) as any;
    const avatarUrl = new URL(json.profile.avatar, "http://localhost");
    const domain = new JMComicClient().getImageDomain();

    assert.equal(avatarUrl.pathname, "/api/image/proxy");
    assert.equal(avatarUrl.searchParams.get("decrypt"), "false");
    assert.equal(avatarUrl.searchParams.get("format"), "original");
    assert.equal(
      avatarUrl.searchParams.get("url"),
      `https://${domain}/media/users/20388553.jpg`,
    );
  } finally {
    (JMComicClient.prototype as any).getCachedProfileSnapshot = originalGetCachedProfileSnapshot;
    JMComicClient.prototype.fetchProfile = originalFetchProfile;
  }
});

test("GET /api/profile preserves avatar query strings when building JM user image URLs", async () => {
  const originalGetCachedProfileSnapshot = (JMComicClient.prototype as any).getCachedProfileSnapshot;
  const originalFetchProfile = JMComicClient.prototype.fetchProfile;
  (JMComicClient.prototype as any).getCachedProfileSnapshot = function getCachedProfileSnapshotMock() {
    return {
      username: "jm_user",
      nickname: "小鲸鱼",
      photo: "20388553.jpg?imageMogr2/thumbnail/240x",
    };
  };
  JMComicClient.prototype.fetchProfile = async function fetchProfileMock() {
    throw new Error("should not fetch profile upstream when cached login snapshot exists");
  };

  try {
    const response = await app.request(new Request("http://localhost/api/profile"));
    assert.equal(response.status, 200);
    const json = (await response.json()) as any;
    const avatarUrl = new URL(json.profile.avatar, "http://localhost");
    const domain = new JMComicClient().getImageDomain();

    assert.equal(
      avatarUrl.searchParams.get("url"),
      `https://${domain}/media/users/20388553.jpg?imageMogr2/thumbnail/240x`,
    );
  } finally {
    (JMComicClient.prototype as any).getCachedProfileSnapshot = originalGetCachedProfileSnapshot;
    JMComicClient.prototype.fetchProfile = originalFetchProfile;
  }
});

test("GET /api/profile falls back to raw.avatar_url when top-level avatar fields are missing", async () => {
  const originalGetCachedProfileSnapshot = (JMComicClient.prototype as any).getCachedProfileSnapshot;
  const originalFetchProfile = JMComicClient.prototype.fetchProfile;
  (JMComicClient.prototype as any).getCachedProfileSnapshot = function getCachedProfileSnapshotMock() {
    return {
      username: "jm_user",
      nickname: "小鲸鱼",
      raw: {
        avatar_url: "https://cdn.example/from-raw-avatar.jpg",
      },
    };
  };
  JMComicClient.prototype.fetchProfile = async function fetchProfileMock() {
    throw new Error("should not fetch profile upstream when cached login snapshot exists");
  };

  try {
    const response = await app.request(new Request("http://localhost/api/profile"));
    assert.equal(response.status, 200);
    const json = (await response.json()) as any;
    const avatarUrl = new URL(json.profile.avatar, "http://localhost");

    assert.equal(
      avatarUrl.searchParams.get("url"),
      "https://cdn.example/from-raw-avatar.jpg",
    );
  } finally {
    (JMComicClient.prototype as any).getCachedProfileSnapshot = originalGetCachedProfileSnapshot;
    JMComicClient.prototype.fetchProfile = originalFetchProfile;
  }
});

test("GET /api/profile falls back to raw.photo when direct avatar fields are missing", async () => {
  const originalGetCachedProfileSnapshot = (JMComicClient.prototype as any).getCachedProfileSnapshot;
  const originalFetchProfile = JMComicClient.prototype.fetchProfile;
  (JMComicClient.prototype as any).getCachedProfileSnapshot = function getCachedProfileSnapshotMock() {
    return {
      username: "jm_user",
      nickname: "小鲸鱼",
      raw: {
        photo: "raw-avatar.jpg",
      },
    };
  };
  JMComicClient.prototype.fetchProfile = async function fetchProfileMock() {
    throw new Error("should not fetch profile upstream when cached login snapshot exists");
  };

  try {
    const response = await app.request(new Request("http://localhost/api/profile"));
    assert.equal(response.status, 200);
    const json = (await response.json()) as any;
    const avatarUrl = new URL(json.profile.avatar, "http://localhost");
    const domain = new JMComicClient().getImageDomain();

    assert.equal(
      avatarUrl.searchParams.get("url"),
      `https://${domain}/media/users/raw-avatar.jpg`,
    );
  } finally {
    (JMComicClient.prototype as any).getCachedProfileSnapshot = originalGetCachedProfileSnapshot;
    JMComicClient.prototype.fetchProfile = originalFetchProfile;
  }
});

test("GET /api/profile degrades missing fields to null", async () => {
  const originalGetCachedProfileSnapshot = (JMComicClient.prototype as any).getCachedProfileSnapshot;
  const originalFetchProfile = JMComicClient.prototype.fetchProfile;
  (JMComicClient.prototype as any).getCachedProfileSnapshot = function getCachedProfileSnapshotMock() {
    return {
      username: "jm_user",
    };
  };
  JMComicClient.prototype.fetchProfile = async function fetchProfileMock() {
    throw new Error("should not fetch profile upstream when cached login snapshot exists");
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
    (JMComicClient.prototype as any).getCachedProfileSnapshot = originalGetCachedProfileSnapshot;
    JMComicClient.prototype.fetchProfile = originalFetchProfile;
  }
});

test("GET /api/profile returns logged-out structure when upstream requires login", async () => {
  const originalGetCachedProfileSnapshot = (JMComicClient.prototype as any).getCachedProfileSnapshot;
  const originalFetchProfile = JMComicClient.prototype.fetchProfile;
  (JMComicClient.prototype as any).getCachedProfileSnapshot = function getCachedProfileSnapshotMock() {
    return null;
  };
  JMComicClient.prototype.fetchProfile = async function fetchProfileMock() {
    throw new Error('data返回值异常: {"code":200,"data":[],"errorMsg":"Not legal.user"}');
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
    (JMComicClient.prototype as any).getCachedProfileSnapshot = originalGetCachedProfileSnapshot;
    JMComicClient.prototype.fetchProfile = originalFetchProfile;
  }
});
