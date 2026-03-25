import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const SESSIONS_FILE = join(process.cwd(), "sessions.json");

let store: Record<string, string> = {};

export function loadSessions(): void {
  if (!existsSync(SESSIONS_FILE)) return;
  try {
    store = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
  } catch {
    store = {};
  }
}

function persist(): void {
  writeFile(SESSIONS_FILE, JSON.stringify(store, null, 2), "utf8").catch((e) => {
    console.warn("[sessions] Failed to persist sessions:", e);
  });
}

export function getSessionId(issueKey: string): string | undefined {
  return store[issueKey];
}

export function setSessionId(issueKey: string, sessionId: string): void {
  store[issueKey] = sessionId;
  persist();
}

export function clearSessionId(issueKey: string): void {
  delete store[issueKey];
  persist();
}
