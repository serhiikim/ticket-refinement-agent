import { describe, it, expect, vi, beforeEach } from "vitest";
import { runClaudeCode, runClaudeCodeImplement } from "./claudeRunner.ts";

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

import { execSync, spawnSync } from "node:child_process";

const mockExecSync = vi.mocked(execSync);
const mockSpawnSync = vi.mocked(spawnSync);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: git fetch succeeds
  mockExecSync.mockReturnValue(Buffer.from(""));
});

describe("runClaudeCode", () => {
  it("parses a valid JSON response wrapped in {result}", async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        result: JSON.stringify({
          action: "enhance",
          description: "Fixed the bug",
          acceptanceCriteria: ["It works"],
          affectedFiles: ["src/foo.ts"],
        }),
      }),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const { response } = await runClaudeCode("/tmp/repo", "main", "test prompt");

    expect(response.action).toBe("enhance");
    expect(response.description).toBe("Fixed the bug");
    expect(response.affectedFiles).toEqual(["src/foo.ts"]);
  });

  it("parses a valid JSON response not wrapped", async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        action: "clarify",
        questions: ["What is the expected behavior?"],
      }),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const { response } = await runClaudeCode("/tmp/repo", "main", "test prompt");

    expect(response.action).toBe("clarify");
    expect(response.questions).toEqual(["What is the expected behavior?"]);
  });

  it("strips markdown code fences from response", async () => {
    const json = JSON.stringify({
      action: "enhance",
      description: "desc",
    });

    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ result: "```json\n" + json + "\n```" }),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const { response } = await runClaudeCode("/tmp/repo", "main", "test prompt");

    expect(response.action).toBe("enhance");
    expect(response.description).toBe("desc");
  });

  it("throws on non-zero exit code", async () => {
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "Something went wrong",
      pid: 1,
      output: [],
      signal: null,
    });

    await expect(
      runClaudeCode("/tmp/repo", "main", "test prompt")
    ).rejects.toThrow("Claude Code exited 1");
  });

  it("throws on unparseable JSON output", async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "this is not json at all",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    await expect(
      runClaudeCode("/tmp/repo", "main", "test prompt")
    ).rejects.toThrow("Failed to parse Claude response as JSON");
  });

  it("calls git fetch and reset before running Claude", async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ action: "clarify", questions: ["?"] }),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    await runClaudeCode("/tmp/repo", "main", "prompt");

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("git -C \"/tmp/repo\" fetch origin"),
      expect.any(Object)
    );
  });

  it("extracts session_id from the JSON wrapper", async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        result: JSON.stringify({ action: "clarify", questions: ["?"] }),
        session_id: "abc-123",
      }),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const { sessionId } = await runClaudeCode("/tmp/repo", "main", "prompt");
    expect(sessionId).toBe("abc-123");
  });

  it("passes --resume flag when sessionId is provided", async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ action: "clarify", questions: ["?"] }),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    await runClaudeCode("/tmp/repo", "main", "prompt", "my-session-id");

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["--resume", "my-session-id"]),
      expect.any(Object)
    );
  });

  it("does not pass --resume flag when no sessionId", async () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ action: "clarify", questions: ["?"] }),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    await runClaudeCode("/tmp/repo", "main", "prompt");

    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args).not.toContain("--resume");
  });
});

describe("runClaudeCodeImplement", () => {
  const successSpawn = {
    status: 0,
    stdout: "",
    stderr: "",
    pid: 1,
    output: [],
    signal: null,
  };

  beforeEach(() => {
    mockSpawnSync.mockReturnValue(successSpawn);
  });

  it("returns branch name when Claude leaves uncommitted changes", async () => {
    mockExecSync
      .mockReturnValueOnce("") // git checkout + reset (continue)
      .mockReturnValueOnce("M src/foo.ts\n") // git status --porcelain (dirty)
      .mockReturnValueOnce("") // git add -A
      .mockReturnValueOnce("") // git commit
      .mockReturnValueOnce("1\n") // rev-list count
      .mockReturnValueOnce("") // git push
      .mockReturnValueOnce(""); // git checkout base (finally)

    const result = await runClaudeCodeImplement(
      "/tmp/repo", "main", "ai/issue-1-my-feature", "prompt", undefined, "continue"
    );

    expect(result).toBe("ai/issue-1-my-feature");
  });

  it("returns branch name when Claude committed itself (clean status but unpushed commits)", async () => {
    mockExecSync
      .mockReturnValueOnce("") // git checkout + reset (continue)
      .mockReturnValueOnce("") // git status --porcelain (clean — Claude committed)
      .mockReturnValueOnce("2\n") // rev-list count — 2 commits ahead
      .mockReturnValueOnce("") // git push
      .mockReturnValueOnce(""); // git checkout base (finally)

    const result = await runClaudeCodeImplement(
      "/tmp/repo", "main", "ai/issue-1-my-feature", "prompt", undefined, "continue"
    );

    expect(result).toBe("ai/issue-1-my-feature");
  });

  it("returns undefined when Claude made no changes", async () => {
    mockExecSync
      .mockReturnValueOnce("") // git checkout + reset (continue)
      .mockReturnValueOnce("") // git status --porcelain (clean)
      .mockReturnValueOnce("0\n") // rev-list count — nothing ahead
      .mockReturnValueOnce(""); // git checkout base (finally)

    const result = await runClaudeCodeImplement(
      "/tmp/repo", "main", "ai/issue-1-my-feature", "prompt", undefined, "continue"
    );

    expect(result).toBeUndefined();
  });

  it("treats rev-list failure as having commits (new branch not yet on remote)", async () => {
    mockExecSync
      .mockReturnValueOnce("") // git checkout baseBranch + reset (create)
      .mockReturnValueOnce("") // git checkout -B branchName
      .mockReturnValueOnce("") // git status --porcelain (clean)
      .mockImplementationOnce(() => { throw new Error("unknown revision origin/ai/issue-1-my-feature"); }) // rev-list throws
      .mockReturnValueOnce("") // git push --force-with-lease
      .mockReturnValueOnce(""); // git checkout base (finally)

    const result = await runClaudeCodeImplement(
      "/tmp/repo", "main", "ai/issue-1-my-feature", "prompt", undefined, "create"
    );

    expect(result).toBe("ai/issue-1-my-feature");
  });
});
