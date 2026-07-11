import test from "node:test";
import assert from "node:assert/strict";

import { JMComicClient } from "./jmClient";

test("JMComicClient requestWithRetry falls back to insecure TLS dispatcher on certificate chain errors", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ dispatcher?: unknown }> = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const dispatcher = (init as RequestInit & { dispatcher?: unknown } | undefined)?.dispatcher;
    calls.push({ dispatcher });

    if (!dispatcher) {
      const error = new TypeError("fetch failed");
      Object.assign(error, {
        cause: {
          code: "SELF_SIGNED_CERT_IN_CHAIN",
        },
      });
      throw error;
    }

    return new Response("ok", { status: 200 });
  }) as typeof globalThis.fetch;

  try {
    const client = new JMComicClient({
      api_domains: ["www.example.com"],
      auto_update_api_domains: false,
      require_api_cookies: false,
      retry_times: 0,
    });
    (client as any).insecureFetch = async (_input: string, init: RequestInit & { dispatcher?: unknown }) => {
      calls.push({ dispatcher: init.dispatcher });
      return new Response("ok", { status: 200 });
    };

    const response = await (client as any).requestWithRetry("https://www.example.com/setting", {
      method: "GET",
      headers: {},
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.dispatcher, undefined);
    assert.ok(calls[1]?.dispatcher);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JMComicClient requestApi continues when init fails but AVS cookie already exists", async () => {
  const client = new JMComicClient({
    api_domains: ["www.example.com"],
    auto_update_api_domains: false,
    require_api_cookies: true,
    retry_times: 0,
  }) as any;

  client.cookieJar.set("AVS", "session-token");
  client.init = async () => {
    throw new Error("请求重试全部失败: [/setting]，TypeError: fetch failed");
  };
  client.buildApiHeaders = () => ({ headers: {}, ts: "0" });
  client.buildFetchInit = () => ({ method: "GET", headers: {} });
  client.requestWithRetry = async () => new Response("{}", { status: 200 });
  client.ensureApiShape = () => {};
  client.captureCookies = () => {};
  client.parseApiEnvelope = () => ({ code: 200, data: "e30=" });
  client.decodeRespData = () => "{}";

  const result = await client.requestApi("/user/profile");
  assert.deepEqual(result.data, {});
});
