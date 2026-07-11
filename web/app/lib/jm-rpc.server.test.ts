import assert from "node:assert/strict";
import test from "node:test";

import { getApiOrigin } from "./jm-rpc.server";

test("getApiOrigin prefers API_ORIGIN when provided", () => {
  const env = process.env as Record<string, string | undefined>;
  const prevApiOrigin = process.env.API_ORIGIN;
  const prevServerOrigin = process.env.JM_SERVER_ORIGIN;

  env.API_ORIGIN = "https://api.example.com/";
  delete env.JM_SERVER_ORIGIN;

  try {
    const request = new Request("https://web.example.com/search?q=test");
    assert.equal(getApiOrigin(request), "https://api.example.com");
  } finally {
    if (prevApiOrigin === undefined) {
      delete env.API_ORIGIN;
    } else {
      process.env.API_ORIGIN = prevApiOrigin;
    }

    if (prevServerOrigin === undefined) {
      delete env.JM_SERVER_ORIGIN;
    } else {
      process.env.JM_SERVER_ORIGIN = prevServerOrigin;
    }
  }
});

test("getApiOrigin prefers local Hono API when running on localhost without NODE_ENV", () => {
  const env = process.env as Record<string, string | undefined>;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevServerOrigin = process.env.JM_SERVER_ORIGIN;

  delete env.NODE_ENV;
  delete env.JM_SERVER_ORIGIN;

  try {
    const request = new Request("http://127.0.0.1:3000/me?profile-retry=profile");
    assert.equal(getApiOrigin(request), "http://127.0.0.1:8787");
  } finally {
    if (prevNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      process.env.NODE_ENV = prevNodeEnv;
    }

    if (prevServerOrigin === undefined) {
      delete env.JM_SERVER_ORIGIN;
    } else {
      process.env.JM_SERVER_ORIGIN = prevServerOrigin;
    }
  }
});
