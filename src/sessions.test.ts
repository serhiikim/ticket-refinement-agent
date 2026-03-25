import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadSessions, getSessionId, setSessionId, clearSessionId } from "./sessions.ts";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the in-memory store by loading from empty
  mockExistsSync.mockReturnValue(false);
  loadSessions();
});

describe("sessions", () => {
  it("returns undefined for unknown issue key", () => {
    expect(getSessionId("org/repo#1")).toBeUndefined();
  });

  it("stores and retrieves a session ID", () => {
    setSessionId("org/repo#1", "session-abc");
    expect(getSessionId("org/repo#1")).toBe("session-abc");
  });

  it("clears a session ID", () => {
    setSessionId("org/repo#1", "session-abc");
    clearSessionId("org/repo#1");
    expect(getSessionId("org/repo#1")).toBeUndefined();
  });

  it("persists to disk on set", () => {
    setSessionId("org/repo#1", "session-xyz");
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse(
      (mockWriteFileSync.mock.calls[0][1] as string)
    );
    expect(written["org/repo#1"]).toBe("session-xyz");
  });

  it("persists to disk on clear", () => {
    setSessionId("org/repo#1", "session-xyz");
    mockWriteFileSync.mockClear();
    clearSessionId("org/repo#1");
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it("loads existing sessions from disk on loadSessions", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ "org/repo#42": "loaded-session" })
    );
    loadSessions();
    expect(getSessionId("org/repo#42")).toBe("loaded-session");
  });

  it("handles corrupt sessions file gracefully", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not valid json");
    expect(() => loadSessions()).not.toThrow();
    expect(getSessionId("org/repo#1")).toBeUndefined();
  });
});
