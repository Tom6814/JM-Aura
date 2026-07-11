import { serve } from "@hono/node-server";

import app from "./index";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`JM Hono API listening on http://localhost:${info.port}`);
  },
);
