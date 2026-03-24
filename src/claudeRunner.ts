import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function resolveClaudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  try {
    return execSync("which claude", { encoding: "utf8" }).trim();
  } catch {
    return "claude"; // fallback, will fail with a clear ENOENT if not found
  }
}

const claudeBin = resolveClaudeBin();

export interface ClaudeResponse {
  action: "clarify" | "enhance";
  // clarify
  questions?: string[];
  // enhance
  description?: string;
  acceptanceCriteria?: string[];
  affectedFiles?: string[];
  edgeCases?: string[];
  risks?: string[];
  createDraftPr?: boolean;
}

export async function runClaudeCode(
  localPath: string,
  branch: string,
  prompt: string
): Promise<ClaudeResponse> {
  // Pull latest
  try {
    execSync(`git -C "${localPath}" fetch origin && git -C "${localPath}" reset --hard origin/${branch}`, {
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (e) {
    console.warn("[claudeRunner] git pull failed, continuing with local state:", e);
  }

  // Run claude code with --print flag (non-interactive, stream-json for token counts)
  const result = spawnSync(
    claudeBin,
    ["--print", "--output-format", "stream-json", prompt],
    {
      cwd: localPath,
      encoding: "utf8",
      timeout: 300_000, // 5 min — large repos need time
      env: {
        ...process.env,
        // Disable telemetry noise
        CLAUDE_NO_TELEMETRY: "1",
      },
    }
  );

  if (result.error) {
    throw new Error(`Claude Code failed to run: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = result.signal
      ? `killed by signal ${result.signal}`
      : result.stderr?.slice(0, 500) ?? "no stderr";
    throw new Error(`Claude Code exited ${result.status}: ${detail}`);
  }

  // stream-json emits NDJSON: one event per line.
  // "assistant" events carry per-turn token usage; "result" event has cost/duration summary.
  let text = result.stdout.trim();
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | undefined;
  let durationMs: number | undefined;
  let numTurns: number | undefined;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "assistant") {
        const usage = (event.message as Record<string, unknown>)?.usage as Record<string, number> | undefined;
        if (usage) {
          inputTokens += usage.input_tokens ?? 0;
          outputTokens += usage.output_tokens ?? 0;
        }
      } else if (event.type === "result") {
        costUsd = event.cost_usd as number | undefined;
        durationMs = event.duration_ms as number | undefined;
        numTurns = event.num_turns as number | undefined;
        text = (event.result as string | undefined) ?? text;
      }
    } catch {
      // skip malformed lines
    }
  }

  const stats = [
    inputTokens > 0 ? `input=${inputTokens}` : null,
    outputTokens > 0 ? `output=${outputTokens}` : null,
    costUsd != null ? `cost=$${costUsd.toFixed(4)}` : null,
    durationMs != null ? `duration=${(durationMs / 1000).toFixed(1)}s` : null,
    numTurns != null ? `turns=${numTurns}` : null,
  ].filter(Boolean);
  if (stats.length > 0) {
    console.log(`[claudeRunner] Usage: ${stats.join(", ")}`);
  }

  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();

  try {
    return JSON.parse(text) as ClaudeResponse;
  } catch {
    throw new Error(`Failed to parse Claude response as JSON:\n${text.slice(0, 1000)}`);
  }
}

/**
 * Runs Claude Code to implement changes on a new branch, commits, and pushes.
 * Returns the branch name if commits were made, undefined if nothing changed.
 */
export function hasClaudeMd(localPath: string): boolean {
  return existsSync(`${localPath}/CLAUDE.md`);
}

export async function runClaudeCodeImplement(
  localPath: string,
  baseBranch: string,
  branchName: string,
  prompt: string
): Promise<string | undefined> {
  // Ensure we're on the base branch with latest changes
  execSync(
    `git -C "${localPath}" checkout ${baseBranch} && git -C "${localPath}" reset --hard origin/${baseBranch}`,
    { stdio: "pipe", timeout: 30_000 }
  );

  // Create or reset branch (-B force-recreates if it already exists)
  execSync(`git -C "${localPath}" checkout -B "${branchName}"`, {
    stdio: "pipe",
    timeout: 10_000,
  });

  try {
    // Run Claude to write code (--dangerously-skip-permissions allows file writes without prompts)
    spawnSync(
      claudeBin,
      ["--print", "--dangerously-skip-permissions", prompt],
      {
        cwd: localPath,
        encoding: "utf8",
        timeout: 300_000,
        env: { ...process.env, CLAUDE_NO_TELEMETRY: "1" },
      }
    );

    // Check if anything changed
    const status = execSync(`git -C "${localPath}" status --porcelain`, {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();

    if (!status) {
      console.log(`[claudeRunner] No file changes on branch ${branchName}, skipping PR`);
      return undefined;
    }

    // Commit
    execSync(`git -C "${localPath}" add -A`, { stdio: "pipe", timeout: 10_000 });
    execSync(
      `git -C "${localPath}" -c user.email="ai-agent@local" -c user.name="AI Ticket Agent" commit -m "feat: scaffold implementation for issue"`,
      { stdio: "pipe", timeout: 10_000 }
    );

    // Push
    execSync(`git -C "${localPath}" push origin "${branchName}"`, {
      stdio: "pipe",
      timeout: 30_000,
    });

    console.log(`[claudeRunner] Pushed branch ${branchName}`);
    return branchName;
  } finally {
    // Always return to base branch to keep repo clean for next run
    execSync(`git -C "${localPath}" checkout ${baseBranch}`, {
      stdio: "pipe",
      timeout: 10_000,
    });
  }
}
