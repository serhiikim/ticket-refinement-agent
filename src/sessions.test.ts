import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { loadSessions, getSessionId, setSessionId, clearSession, getPrNumber, setPrNumber } from "./sessions.ts";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFile = vi.mocked(writeFile);

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

  it("clears a session entry", () => {
    setSessionId("org/repo#1", "session-abc");
    clearSession("org/repo#1");
    expect(getSessionId("org/repo#1")).toBeUndefined();
  });

  it("persists to disk on set", () => {
    setSessionId("org/repo#1", "session-xyz");
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const written = JSON.parse(
      (mockWriteFile.mock.calls[0][1] as string)
    );
    expect(written["org/repo#1"].sessionId).toBe("session-xyz");
  });

  it("persists to disk on clear", () => {
    setSessionId("org/repo#1", "session-xyz");
    mockWriteFile.mockClear();
    clearSession("org/repo#1");
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it("loads existing sessions from disk on loadSessions", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ "org/repo#42": { sessionId: "loaded-session" } })
    );
    loadSessions();
    expect(getSessionId("org/repo#42")).toBe("loaded-session");
  });

  it("migrates old string-format sessions on load", () => {
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

  describe("prNumber", () => {
    it("returns undefined for unknown key", () => {
      expect(getPrNumber("org/repo#1")).toBeUndefined();
    });

    it("stores and retrieves a PR number", () => {
      setPrNumber("org/repo#1", 42);
      expect(getPrNumber("org/repo#1")).toBe(42);
    });

    it("preserves sessionId when setting prNumber", () => {
      setSessionId("org/repo#1", "session-abc");
      setPrNumber("org/repo#1", 99);
      expect(getSessionId("org/repo#1")).toBe("session-abc");
      expect(getPrNumber("org/repo#1")).toBe(99);
    });

    it("preserves prNumber when setting sessionId", () => {
      setPrNumber("org/repo#1", 77);
      setSessionId("org/repo#1", "session-xyz");
      expect(getPrNumber("org/repo#1")).toBe(77);
      expect(getSessionId("org/repo#1")).toBe("session-xyz");
    });

    it("clears prNumber when session is cleared", () => {
      setPrNumber("org/repo#1", 42);
      clearSession("org/repo#1");
      expect(getPrNumber("org/repo#1")).toBeUndefined();
    });
  });
});
