import { z } from "zod";

import type { HttpClient } from "../http";
import { searchResultSchema, SEARCH_MAIN_TAGS, ORDER_BY_VALUES, TIME_VALUES } from "../../../packages/shared/src/schema";

const searchArgsSchema = z.object({
  keyword: z.string().min(1),
  page: z.number().int().positive().default(1),
  main_tag: z.number().int().default(0),
  order_by: z.string().default("mr"),
  time: z.string().default("a"),
});

export async function runSearch(client: HttpClient, argv: string[]): Promise<void> {
  const opts = parseSearchArgs(argv);
  const result = await client.postJson(
    "/api/search",
    {
      keyword: opts.keyword,
      page: opts.page,
      main_tag: opts.main_tag,
      order_by: opts.order_by,
      time: opts.time,
    },
    searchResultSchema,
  );

  process.stdout.write(
    `命中 ${result.total} 条，第 ${opts.page}/${result.page_count || 1} 页（page_size=${result.page_size}）\n`,
  );

  if (result.is_single_album && result.single_album) {
    process.stdout.write(`精确匹配：${result.single_album.album_id} ${result.single_album.name}\n`);
    return;
  }

  if (result.content.length === 0) {
    process.stdout.write("没有结果。\n");
    return;
  }

  for (const item of result.content) {
    const author = item.author ? ` / ${item.author}` : "";
    process.stdout.write(`${item.id}\t${item.name}${author}\n`);
  }
}

function parseSearchArgs(argv: string[]) {
  const positionals: string[] = [];
  let page = 1;
  let main_tag = 0;
  let order_by = "mr";
  let time = "a";

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--page") {
      page = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--main-tag") {
      main_tag = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--order-by") {
      order_by = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (token === "--time") {
      time = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelpAndExit();
    }
    if (token.startsWith("--")) {
      throw new Error(`未知参数：${token}`);
    }
    positionals.push(token);
  }

  const keyword = positionals[0] ?? "";
  if (!keyword) printHelpAndExit("缺少必需参数：<keyword>");

  if (!Number.isInteger(page) || page <= 0) throw new Error("--page 必须是正整数");
  if (!SEARCH_MAIN_TAGS.includes(main_tag as any)) throw new Error(`--main-tag 必须是 ${SEARCH_MAIN_TAGS.join("|")}`);
  if (!ORDER_BY_VALUES.includes(order_by as any)) throw new Error(`--order-by 必须是 ${ORDER_BY_VALUES.join("|")}`);
  if (!TIME_VALUES.includes(time as any)) throw new Error(`--time 必须是 ${TIME_VALUES.join("|")}`);

  return searchArgsSchema.parse({ keyword, page, main_tag, order_by, time });
}

function printHelpAndExit(error?: string): never {
  if (error) process.stderr.write(`${error}\n\n`);
  process.stderr.write(
    [
      "用法：",
      "  tsx cli/src/index.ts [--origin http://127.0.0.1:8787] search <keyword> [--page N] [--main-tag 0|1|2|3|4] [--order-by mr|mv|mp|tf] [--time a|t|w|m]",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
