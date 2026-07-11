import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sessionFileSchema = z
  .object({
    sessionId: z.string().min(1),
    createdAt: z.number().int().positive(),
  })
  .strict();

export type SessionFile = z.infer<typeof sessionFileSchema>;

function getDefaultSessionFilePath(): string {
  // cli/src/storage/sessionStore.ts -> cli/.data/session.json
  return fileURLToPath(new URL("../../.data/session.json", import.meta.url));
}

export class SessionStore {
  readonly filePath: string;

  constructor(options?: { filePath?: string }) {
    this.filePath = options?.filePath ?? getDefaultSessionFilePath();
  }

  async getOrCreateSessionId(): Promise<string> {
    const session = await this.readOrCreate();
    return session.sessionId;
  }

  async readOrCreate(): Promise<SessionFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = sessionFileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch (err: any) {
      // fallthrough to create
      if (err?.code !== "ENOENT") {
        // ignore invalid JSON etc, recreate below
      }
    }

    const created: SessionFile = {
      sessionId: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(created, null, 2) + "\n", "utf8");
    return created;
  }
}

