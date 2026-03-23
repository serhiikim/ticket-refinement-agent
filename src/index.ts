import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import { filterEvent } from "./eventFilter.ts";
import { buildContext, buildPrompt, buildCodingPrompt } from "./contextBuilder.ts";
import { runClaudeCode, runClaudeCodeImplement } from "./claudeRunner.ts";
import { handleClarify, handleEnhance, postDraftPrComment } from "./actionHandler.ts";
import type { ClaudeResponse } from "./claudeRunner.ts";

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

  const { repoFullName, issueNumber } = filter;

  // Look up local repo
  const repoConfig = config.repos[repoFullName!];
  if (!repoConfig) {
    console.warn(`[webhook] No local repo configured for ${repoFullName}`);
    return c.json({ error: `no repo config for ${repoFullName}` }, 404);
  }

  // Respond immediately, process async
  c.header("Content-Type", "application/json");
  const response = new Response(JSON.stringify({ accepted: true }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });

  // Dedup: skip if already processing this issue
  const jobKey = `${repoFullName}#${issueNumber}`;
  if (processingSet.has(jobKey)) {
    console.log(`[webhook] Skipping duplicate job ${jobKey}`);
    return c.json({ skipped: true, reason: "duplicate" });
  }
  processingSet.add(jobKey);

  // Serialize per repo, fire-and-forget
  withRepoLock(repoConfig.localPath, () =>
    processIssue(repoFullName!, issueNumber!, repoConfig).finally(() => {
      processingSet.delete(jobKey);
    })
  ).catch((err) => {
    console.error(`[processIssue] ${jobKey} failed:`, err);
    processingSet.delete(jobKey);
  });

  return response;
});

async function processIssue(
  repoFullName: string,
  issueNumber: number,
  repoConfig: { localPath: string; branch: string }
): Promise<void> {
  console.log(`[process] Starting ${repoFullName}#${issueNumber}`);

  const ctx = await buildContext(repoFullName, issueNumber);
  const prompt = buildPrompt(ctx);

  const result: ClaudeResponse = await runClaudeCode(
    repoConfig.localPath,
    repoConfig.branch,
    prompt
  );

  console.log(`[process] Claude action: ${result.action} for ${repoFullName}#${issueNumber}`);

  if (result.action === "clarify") {
    await handleClarify(repoFullName, issueNumber, result as ClaudeResponse & { action: "clarify" });
  } else if (result.action === "enhance") {
    const enhance = result as ClaudeResponse & { action: "enhance" };

    // Update issue description first
    await handleEnhance(
      repoFullName,
      issueNumber,
      ctx.issue.title,
      repoConfig.branch,
      enhance
    );

    // Then run coding pass if requested
    if (enhance.createDraftPr) {
      const branchName = `ai/issue-${issueNumber}-${slugify(ctx.issue.title)}`;
      const codingPrompt = buildCodingPrompt(ctx, enhance);
      console.log(`[process] Running coding pass on branch ${branchName}`);
      const pushedBranch = await runClaudeCodeImplement(
        repoConfig.localPath,
        repoConfig.branch,
        branchName,
        codingPrompt
      );
      if (pushedBranch) {
        await postDraftPrComment(
          repoFullName,
          issueNumber,
          ctx.issue.title,
          repoConfig.branch,
          branchName,
          enhance
        );
      }
    }
  } else {
    console.warn(`[process] Unknown action: ${(result as { action: string }).action}`);
  }
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

  // Stop accepting new connections
  server.close();

  // Wait for all repo locks (in-flight jobs) to finish
  await Promise.allSettled([...repoLocks.values()]);

  console.log("[shutdown] All jobs drained, exiting.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

