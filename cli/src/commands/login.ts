import { loginResultSchema } from "../../../packages/shared/src/schema";
import type { HttpClient } from "../http";

export async function runLogin(client: HttpClient, argv: string[]): Promise<void> {
  const opts = parseLoginArgs(argv);

  const result = await client.postJson(
    "/api/auth/login",
    { username: opts.username, password: opts.password },
    loginResultSchema,
  );

  process.stdout.write(
    `登录成功：${result.username} (uid=${result.uid}) level=${result.level} coin=${result.coin}\n`,
  );
}

function parseLoginArgs(argv: string[]): { username: string; password: string } {
  let username: string | null = null;
  let password: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--username") {
      username = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--password") {
      password = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelpAndExit();
    }
  }

  if (!username || !password) {
    printHelpAndExit("缺少必需参数：--username 与 --password");
  }

  return { username, password };
}

function printHelpAndExit(error?: string): never {
  if (error) process.stderr.write(`${error}\n\n`);
  process.stderr.write(
    [
      "用法：",
      "  tsx cli/src/index.ts [--origin http://127.0.0.1:8787] login --username <u> --password <p>",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
