import { HttpClient, HttpError } from "./http";
import { SessionStore } from "./storage/sessionStore";
import { runLogin } from "./commands/login";
import { runExportAlbum } from "./commands/exportAlbum";
import { runExportFavorites } from "./commands/exportFavorites";
import { runSearch } from "./commands/search";
import { runTasks } from "./commands/tasks";

const DEFAULT_ORIGIN = "http://127.0.0.1:8787";

async function main() {
  const argv = process.argv.slice(2);
  const { origin, rest } = parseGlobalArgs(argv);

  const command = rest[0];
  if (!command || command === "--help" || command === "-h") {
    printHelpAndExit();
  }

  const store = new SessionStore();
  const sessionId = await store.getOrCreateSessionId();
  const client = new HttpClient({ origin, sessionId });

  const cmdArgs = rest.slice(1);

  switch (command) {
    case "login":
      await runLogin(client, cmdArgs);
      return;
    case "search":
      await runSearch(client, cmdArgs);
      return;
    case "export-album":
      await runExportAlbum(client, cmdArgs);
      return;
    case "export-favorites":
      await runExportFavorites(client, cmdArgs);
      return;
    case "tasks":
      await runTasks(client, cmdArgs);
      return;
    default:
      printHelpAndExit(`未知命令：${command}`);
  }
}

function parseGlobalArgs(argv: string[]): { origin: string; rest: string[] } {
  let origin = DEFAULT_ORIGIN;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--origin") {
      origin = (argv[i + 1] ?? "").trim() || DEFAULT_ORIGIN;
      i += 1;
      continue;
    }
    rest.push(token);
  }

  return { origin, rest };
}

function printHelpAndExit(error?: string): never {
  if (error) process.stderr.write(`${error}\n\n`);
  process.stderr.write(
    [
      "JM-Aura CLI（最小可用）",
      "",
      "用法：",
      "  tsx cli/src/index.ts [--origin http://127.0.0.1:8787] <command> [args...]",
      "",
      "命令：",
      "  login --username <u> --password <p>",
      "  search <keyword> [--page N] [--main-tag 0|1|2|3|4] [--order-by mr|mv|mp|tf] [--time a|t|w|m]",
      "  tasks list",
      "  tasks status <taskId>",
      "  export-album <albumId> --out <dir> [--client-zip] [--image-format webp|jpeg|original] [--concurrency N]",
      "  export-favorites --out <dir> [--client-zip] [--folder-id 0] [--order-by mr|mv|mp|tf] [--image-format webp|jpeg|original] [--concurrency N]",
      "",
      "说明：",
      "  - 会话通过 x-jm-session header 传递；首次运行会在 cli/.data/session.json 生成并持久化 uuid。",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

main().catch((err: unknown) => {
  if (err instanceof HttpError) {
    const extra = err.bodyText ? `\n\n响应内容：\n${err.bodyText}` : "";
    process.stderr.write(`请求失败：${err.message}\nURL: ${err.url}${extra}\n`);
    process.exit(1);
  }

  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
