import { PassThrough } from "node:stream";

import { createReadableStreamFromReadable, type EntryContext } from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import { renderToPipeableStream } from "react-dom/server";

export const ABORT_DELAY_MS = 30_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;

    const { pipe, abort } = renderToPipeableStream(<RemixServer context={remixContext} url={request.url} />, {
      onShellReady() {
        shellRendered = true;
        const body = new PassThrough();
        const stream = createReadableStreamFromReadable(body);

        responseHeaders.set("Content-Type", "text/html; charset=utf-8");
        resolve(
          new Response(stream, {
            headers: responseHeaders,
            status: responseStatusCode,
          }),
        );

        pipe(body);
      },
      onShellError(error) {
        reject(error);
      },
      onError(error) {
        responseStatusCode = 500;
        if (shellRendered) {
          console.error(error);
        }
      },
    });

    setTimeout(abort, ABORT_DELAY_MS);
  });
}
