import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import { filterEvent } from "./eventFilter.ts";
import { buildContext, buildPrompt, buildCodingPrompt, buildResumedCodingPrompt } from "./contextBuilder.ts";
import { runClaudeCode, runClaudeCodeImplement, hasClaudeMd } from "./claudeRunner.ts";
import { handleClarify, handleEnhance, handleCodingComplete, postDraftPrComment } from "./actionHandler.ts";
import { loadSessions, getSessionId, setSessionId, clearSessionId } from "./sessions.ts";
import type { TriggerReason } from "./eventFilter.ts";

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

// Deduplication: skip if same issue is already in flight
const processingSet = new Set<string>();

// Per-repo lock: chain promises so only one Claude runs per repo at a time
const repoLocks = new Map<string, Promise<void>>();

function withRepoLock(localPath: string, fn: () => Promise<void>): Promise<void> {
  const prev = repoLocks.get(localPath) ?? Promise.resolve();
  const next = prev.then(fn).catch((err) => {
    console.error(`[repoLock] Job failed for ${localPath}:`, err);
  });
  repoLocks.set(localPath, next);
  return next;
}

loadSessions();

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/webhook/github", async (c) => {
  const rawBody = await c.req.text();
  const sig = c.req.header("x-hub-signature-256") ?? "";
  const eventType = c.req.header("x-github-event") ?? "";

  // Verify HMAC signature
  const expected =
    "sha256=" +
    createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");

  let sigBuf: Buffer, expBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig);
    expBuf = Buffer.from(expected);
  } catch {
    return c.json({ error: "bad signature format" }, 400);
  }

  if (
    sigBuf.length !== expBuf.length ||
    !timingSafeEqual(sigBuf, expBuf)
  ) {
    console.warn("[webhook] Invalid signature");
    return c.json({ error: "invalid signature" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const filter = filterEvent(eventType, payload);
  if (!filter.shouldProcess) {
    return c.json({ skipped: true });
  }

  const { repoFullName, issueNumber, reason } = filter;

  // Dedup: skip if already processing this issue
  const jobKey = `${repoFullName}#${issueNumber}`;
  if (processingSet.has(jobKey)) {
    console.log(`[webhook] Skipping duplicate job ${jobKey}`);
    return c.json({ skipped: true, reason: "duplicate" });
  }
  processingSet.add(jobKey);

  // Look up local repo
  const repoConfig = config.repos[repoFullName!];
  if (!repoConfig) {
    processingSet.delete(jobKey);
    console.warn(`[webhook] No local repo configured for ${repoFullName}`);
    return c.json({ error: `no repo config for ${repoFullName}` }, 404);
  }

  // Serialize per repo, fire-and-forget
  withRepoLock(repoConfig.localPath, () =>
    processIssue(repoFullName!, issueNumber!, repoConfig, reason!).finally(() => {
      processingSet.delete(jobKey);
    })
  ).catch((err) => {
    console.error(`[processIssue] ${jobKey} failed:`, err);
    processingSet.delete(jobKey);
  });

  return c.json({ accepted: true }, 202);
});

async function processIssue(
  repoFullName: string,
  issueNumber: number,
  repoConfig: { localPath: string; branch: string },
  reason: TriggerReason
): Promise<void> {
  console.log(`[process] Starting ${repoFullName}#${issueNumber} (${reason})`);

  const issueKey = `${repoFullName}#${issueNumber}`;

  if (reason === "code_trigger") {
    await runCodingPass(repoFullName, issueNumber, repoConfig, issueKey);
    return;
  }

  // Analysis pass
  const ctx = await buildContext(repoFullName, issueNumber);
  const prompt = buildPrompt(ctx);
  const sessionId = getSessionId(issueKey);

  let runResult = await runClaudeCode(
    repoConfig.localPath,
    repoConfig.branch,
    prompt,
    sessionId
  ).catch(async (err) => {
    // Session may have expired — retry with a fresh session
    if (sessionId) {
      console.warn(`[process] Session resume failed for ${issueKey}, retrying fresh:`, err.message);
      clearSessionId(issueKey);
      return runClaudeCode(repoConfig.localPath, repoConfig.branch, prompt);
    }
    throw err;
  });

  if (runResult.sessionId) {
    setSessionId(issueKey, runResult.sessionId);
  }

  const result = runResult.response;
  console.log(`[process] Claude action: ${result.action} for ${repoFullName}#${issueNumber}`);

  if (result.action === "clarify") {
    await handleClarify(repoFullName, issueNumber, result);
  } else if (result.action === "enhance") {
    await handleEnhance(
      repoFullName,
      issueNumber,
      ctx.issue.title,
      repoConfig.branch,
      result
    );
  } else {
    console.warn(`[process] Unknown action: ${(result as { action: string }).action}`);
  }
}

async function runCodingPass(
  repoFullName: string,
  issueNumber: number,
  repoConfig: { localPath: string; branch: string },
  issueKey: string
): Promise<void> {
  const ctx = await buildContext(repoFullName, issueNumber);
  const sessionId = getSessionId(issueKey);
  const branchName = `ai/issue-${issueNumber}-${slugify(ctx.issue.title)}`;
  const claudeMdExists = hasClaudeMd(repoConfig.localPath);

  console.log(`[process] CLAUDE.md ${claudeMdExists ? "found" : "not found — will create"}`);
  console.log(`[process] Running coding pass on branch ${branchName}${sessionId ? " (resuming session)" : ""}`);

  // If we have a session, use a short resumed prompt; otherwise fall back to full prompt
  const codingPrompt = sessionId
    ? buildResumedCodingPrompt(claudeMdExists)
    : buildCodingPrompt(ctx, { action: "enhance" }, claudeMdExists);

  const pushedBranch = await runClaudeCodeImplement(
    repoConfig.localPath,
    repoConfig.branch,
    branchName,
    codingPrompt,
    sessionId
  );

  if (pushedBranch) {
    await postDraftPrComment(
      repoFullName,
      issueNumber,
      ctx.issue.title,
      repoConfig.branch,
      branchName,
      { action: "enhance", description: ctx.issue.body }
    );
  }

  await handleCodingComplete(repoFullName, issueNumber);
  clearSessionId(issueKey);
}

export { app, repoLocks };

const server = serve(
  { fetch: app.fetch, port: config.port },
  (info) => {
    console.log(`AI Ticket Agent listening on http://localhost:${info.port}`);
    console.log(`Webhook endpoint: POST /webhook/github`);
  }
);

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, draining in-flight jobs...`);

  server.close();

  await Promise.allSettled([...repoLocks.values()]);

  console.log("[shutdown] All jobs drained, exiting.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
