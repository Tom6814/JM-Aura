import test from "node:test";
import assert from "node:assert/strict";

import app from "./index";
import { JMComicClient } from "./jmClient";

test("GET /api/image/proxy supports format=original by resolving to jpeg/webp", async () => {
  const calls: Array<{ format?: string }> = [];

  const originalFetchImageResponse = JMComicClient.prototype.fetchImageResponse;
  const originalDecryptImage = JMComicClient.prototype.decryptImage;

  JMComicClient.prototype.fetchImageResponse = async function fetchImageResponseMock() {
    return new Response(Buffer.from([0xde, 0xad, 0xbe, 0xef]), {
      headers: { "content-type": "image/jpeg" },
    });
  };

  JMComicClient.prototype.decryptImage = async function decryptImageMock(_bytes, ctx) {
    calls.push({ format: ctx.format });
    return {
      data: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
      width: 1,
      height: 1,
      channels: 3,
      format: ctx.format ?? "jpeg",
      segmentCount: 0,
    } as any;
  };

  try {
    const resp = await app.request(
      new Request(
        "http://localhost/api/image/proxy?url=https%3A%2F%2Fimg.example%2Fx.jpg&scramble_id=1&aid=1&img_file_name=00001&decrypt=true&format=original",
      ),
    );

    assert.equal(resp.status, 200);
    assert.equal(calls.length, 1);
    // original should be resolved to jpeg since upstream content-type is image/jpeg
    assert.equal(calls[0]?.format, "jpeg");
  } finally {
    JMComicClient.prototype.fetchImageResponse = originalFetchImageResponse;
    JMComicClient.prototype.decryptImage = originalDecryptImage;
  }
});
