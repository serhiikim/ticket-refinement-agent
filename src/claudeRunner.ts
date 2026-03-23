import { execSync, spawnSync } from "node:child_process";

const claudeBin = process.env.CLAUDE_BIN ?? "claude";

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

  // Run claude code with --print flag (non-interactive JSON output)
  const result = spawnSync(
    claudeBin,
    ["--print", "--output-format", "json", prompt],
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

  const raw = result.stdout.trim();

  // Claude with --output-format json wraps response in {"result": "..."}
  let text: string;
  try {
    const wrapper = JSON.parse(raw) as { result?: string };
    text = wrapper.result ?? raw;
  } catch {
    text = raw;
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

  // Create new branch
  execSync(`git -C "${localPath}" checkout -b "${branchName}"`, {
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
