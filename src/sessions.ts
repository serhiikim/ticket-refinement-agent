import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const SESSIONS_FILE = join(process.cwd(), "sessions.json");

interface SessionEntry {
  sessionId?: string;
  prNumber?: number;
}

let store: Record<string, SessionEntry> = {};

export function loadSessions(): void {
  if (!existsSync(SESSIONS_FILE)) return;
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as Record<string, unknown>;
    store = {};
    for (const [k, v] of Object.entries(raw)) {
      // Migrate old format (plain string sessionId) to new format
      if (typeof v === "string") {
        store[k] = { sessionId: v };
      } else if (v && typeof v === "object") {
        store[k] = v as SessionEntry;
      }
    }
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
  return store[issueKey]?.sessionId;
}

export function setSessionId(issueKey: string, sessionId: string): void {
  store[issueKey] = { ...store[issueKey], sessionId };
  persist();
}

export function getPrNumber(issueKey: string): number | undefined {
  return store[issueKey]?.prNumber;
}

export function setPrNumber(issueKey: string, prNumber: number): void {
  store[issueKey] = { ...store[issueKey], prNumber };
  persist();
}

export function clearSession(issueKey: string): void {
  delete store[issueKey];
  persist();
}
