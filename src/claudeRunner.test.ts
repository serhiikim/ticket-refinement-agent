import { describe, it, expect, vi, beforeEach } from "vitest";
import { runClaudeCode } from "./claudeRunner.ts";

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
    const inner = JSON.stringify({
      action: "enhance",
      description: "Fixed the bug",
      acceptanceCriteria: ["It works"],
      affectedFiles: ["src/foo.ts"],
    });
    mockSpawnSync.mockReturnValue({
      status: 0,
      // stream-json NDJSON: "result" event carries the actual text
      stdout: [
        JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 100, output_tokens: 50 } } }),
        JSON.stringify({ type: "result", subtype: "success", cost_usd: 0.001, duration_ms: 3000, num_turns: 1, result: inner }),
      ].join("\n"),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const result = await runClaudeCode("/tmp/repo", "main", "test prompt");

    expect(result.action).toBe("enhance");
    expect(result.description).toBe("Fixed the bug");
    expect(result.affectedFiles).toEqual(["src/foo.ts"]);
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

    const result = await runClaudeCode("/tmp/repo", "main", "test prompt");

    expect(result.action).toBe("clarify");
    expect(result.questions).toEqual(["What is the expected behavior?"]);
  });

  it("strips markdown code fences from response", async () => {
    const json = JSON.stringify({
      action: "enhance",
      description: "desc",
    });

    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ type: "result", subtype: "success", result: "```json\n" + json + "\n```" }),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const result = await runClaudeCode("/tmp/repo", "main", "test prompt");

    expect(result.action).toBe("enhance");
    expect(result.description).toBe("desc");
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
});
