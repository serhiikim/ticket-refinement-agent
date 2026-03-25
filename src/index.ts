import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.ts";
import { buildPrompt, buildCodingPrompt, buildResumedCodingPrompt } from "./contextBuilder.ts";
import { runClaudeCode, runClaudeCodeImplement, hasClaudeMd } from "./claudeRunner.ts";
import type { ClaudeResponse } from "./claudeRunner.ts";
import { loadSessions, getSessionId, setSessionId, clearSessionId } from "./sessions.ts";
import { GitHubWebhookAdapter } from "./adapters/GitHubWebhookAdapter.ts";
import { GitHubTicketProvider } from "./adapters/GitHubTicketProvider.ts";
import { GitHubSourceControlProvider } from "./adapters/GitHubSourceControlProvider.ts";
import type { GenericTicketEvent, ITicketProvider, ISourceControlProvider } from "./types.ts";

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
const githubAdapter = new GitHubWebhookAdapter();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/webhook/github", async (c) => {
  const rawBody = await c.req.text();
  const headers: Record<string, string> = {
    "x-hub-signature-256": c.req.header("x-hub-signature-256") ?? "",
    "x-github-event": c.req.header("x-github-event") ?? "",
  };

  if (!githubAdapter.verifySignature(rawBody, headers)) {
    console.warn("[webhook] Invalid signature");
    return c.json({ error: "invalid signature" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const event = githubAdapter.parseEvent(headers["x-github-event"], payload);
  if (!event) {
    return c.json({ skipped: true });
  }

  // Dedup: skip if already processing this ticket
  const jobKey = `${event.platform}:${event.ticketId}`;
  if (processingSet.has(jobKey)) {
    console.log(`[webhook] Skipping duplicate job ${jobKey}`);
    return c.json({ skipped: true, reason: "duplicate" });
  }
  processingSet.add(jobKey);

  const repoConfig = config.repos[event.repoIdentifier];
  if (!repoConfig) {
    processingSet.delete(jobKey);
    console.warn(`[webhook] No local repo configured for ${event.repoIdentifier}`);
    return c.json({ error: `no repo config for ${event.repoIdentifier}` }, 404);
  }

  const ticketProvider = new GitHubTicketProvider();
  const scProvider = new GitHubSourceControlProvider(event.repoIdentifier);

  // Serialize per repo, fire-and-forget
  withRepoLock(repoConfig.localPath, () =>
    processIssue(event, repoConfig, ticketProvider, scProvider).finally(() => {
      processingSet.delete(jobKey);
    })
  ).catch((err) => {
    console.error(`[processIssue] ${jobKey} failed:`, err);
    processingSet.delete(jobKey);
  });

  return c.json({ accepted: true }, 202);
});

/**
 * Scans the issue body and comments for a "base-branch: <name>" line.
 * Returns the last match found (so a comment can override the issue body),
 * or defaultBranch if none is specified.
 */
function parseBaseBranch(
  ticket: { body: string },
  comments: { body: string }[],
  defaultBranch: string
): string {
  const pattern = /^base-branch:\s*(\S+)/im;
  let found: string | undefined;
  const bodyMatch = ticket.body.match(pattern);
  if (bodyMatch) found = bodyMatch[1];
  for (const comment of comments) {
    const m = comment.body.match(pattern);
    if (m) found = m[1];
  }
  return found ?? defaultBranch;
}

async function processIssue(
  event: GenericTicketEvent,
  repoConfig: { localPath: string; branch: string },
  ticketProvider: ITicketProvider,
  scProvider: ISourceControlProvider
): Promise<void> {
  console.log(`[process] Starting ${event.ticketId} (${event.triggerReason})`);
  const sessionKey = `${event.platform}:${event.ticketId}`;

  // Fetch upfront — needed for base branch resolution in all trigger paths
  const ticket = await ticketProvider.getTicket(event.ticketId);
  const comments = await ticketProvider.getComments(event.ticketId);
  const baseBranch = parseBaseBranch(ticket, comments, repoConfig.branch);

  if (baseBranch !== repoConfig.branch) {
    console.log(`[process] Base branch override: ${baseBranch} for ${event.ticketId}`);
  }

  if (event.triggerReason === "code_trigger") {
    await runCodingPass(event, ticket, repoConfig, baseBranch, sessionKey, ticketProvider, scProvider);
    return;
  }

  // Analysis pass
  const prompt = buildPrompt(ticket, comments);
  const sessionId = getSessionId(sessionKey);

  let runResult = await runClaudeCode(
    repoConfig.localPath,
    baseBranch,
    prompt,
    sessionId
  ).catch(async (err) => {
    // Session may have expired — retry with a fresh session
    if (sessionId) {
      console.warn(`[process] Session resume failed for ${sessionKey}, retrying fresh:`, err.message);
      clearSessionId(sessionKey);
      return runClaudeCode(repoConfig.localPath, baseBranch, prompt);
    }
    throw err;
  });

  if (runResult.sessionId) {
    setSessionId(sessionKey, runResult.sessionId);
  }

  const result = runResult.response;
  console.log(`[process] Claude action: ${result.action} for ${event.ticketId}`);

  if (result.action === "clarify") {
    const questions = (result as ClaudeResponse & { action: "clarify" }).questions ?? [];
    const body = [
      "### Clarifying Questions",
      "",
      "I need a bit more context before I can fully analyze this ticket. Could you help with the following?",
      "",
      ...questions.map((q, i) => `${i + 1}. ${q}`),
      "",
      "_Once answered, I'll pick this up again automatically._",
    ].join("\n");
    await ticketProvider.postComment(event.ticketId, body);
    await ticketProvider.updateStatus(event.ticketId, "clarifying");
    console.log(`[process] Posted clarifying questions on ${event.ticketId}`);
  } else if (result.action === "enhance") {
    const r = result as ClaudeResponse & { action: "enhance" };
    const enhancedBody = buildEnhancedBody(r);
    await ticketProvider.updateDescription(event.ticketId, enhancedBody);
    await ticketProvider.postComment(event.ticketId, buildEnhancedSummary(r));
    await ticketProvider.updateStatus(event.ticketId, "enhanced");
    console.log(`[process] Enhanced ticket ${event.ticketId}`);
  } else {
    console.warn(`[process] Unknown action: ${(result as { action: string }).action}`);
  }
}

async function runCodingPass(
  event: GenericTicketEvent,
  ticket: { title: string; body: string; ticketId: string; labels: string[] },
  repoConfig: { localPath: string; branch: string },
  baseBranch: string,
  sessionKey: string,
  ticketProvider: ITicketProvider,
  scProvider: ISourceControlProvider
): Promise<void> {
  const sessionId = getSessionId(sessionKey);
  const issueNumber = event.ticketId.split("#")[1] ?? event.ticketId;
  const branchName = `ai/issue-${issueNumber}-${slugify(ticket.title)}`;
  const claudeMdExists = hasClaudeMd(repoConfig.localPath);
  const branchOverride = baseBranch !== repoConfig.branch ? baseBranch : undefined;

  console.log(`[process] CLAUDE.md ${claudeMdExists ? "found" : "not found — will create"}`);
  console.log(`[process] Running coding pass on branch ${branchName} (base: ${baseBranch})${sessionId ? ", resuming session" : ""}`);

  const codingPrompt = sessionId
    ? buildResumedCodingPrompt(claudeMdExists, branchOverride)
    : buildCodingPrompt(ticket, { action: "enhance" }, claudeMdExists, branchOverride);

  const pushedBranch = await runClaudeCodeImplement(
    repoConfig.localPath,
    baseBranch,
    branchName,
    codingPrompt,
    sessionId
  );

  if (pushedBranch) {
    // Build issue URL from ticketId "org/repo#123"
    const [repoFull, issueNumStr] = event.ticketId.split("#");
    const issueUrl = `https://github.com/${repoFull}/issues/${issueNumStr}`;
    const prUrl = await scProvider.createDraftPr(
      ticket.title,
      baseBranch,
      branchName,
      { platform: event.platform, id: event.ticketId, url: issueUrl }
    );
    await ticketProvider.postComment(
      event.ticketId,
      `### Draft PR Ready\n\nCode scaffold has been pushed: ${prUrl}`
    );
  }

  await ticketProvider.updateStatus(event.ticketId, "done");
  clearSessionId(sessionKey);
}

/** Build the enhanced issue body from a Claude enhance response */
function buildEnhancedBody(r: ClaudeResponse & { action: "enhance" }): string {
  const { description, acceptanceCriteria, affectedFiles, edgeCases, risks } = r;
  const sections: string[] = [description ?? ""];

  if (acceptanceCriteria?.length) {
    sections.push("## Acceptance Criteria", ...acceptanceCriteria.map((c) => `- [ ] ${c}`));
  }
  if (affectedFiles?.length) {
    sections.push("## Affected Files", ...affectedFiles.map((f) => `- \`${f}\``));
  }
  if (edgeCases?.length) {
    sections.push("## Edge Cases", ...edgeCases.map((e) => `- ${e}`));
  }
  if (risks?.length) {
    sections.push("## Risks", ...risks.map((rv) => `- ${rv}`));
  }
  sections.push("", "_Enhanced by AI Ticket Agent_");
  return sections.join("\n\n");
}

/** Build the summary comment posted after enhancement */
function buildEnhancedSummary(r: ClaudeResponse & { action: "enhance" }): string {
  const { acceptanceCriteria, affectedFiles, edgeCases, risks } = r;
  return [
    "### Ticket Enhanced",
    "",
    "I've analyzed the codebase and updated the issue body with:",
    acceptanceCriteria?.length ? `- **${acceptanceCriteria.length}** acceptance criteria` : null,
    affectedFiles?.length ? `- **${affectedFiles.length}** affected file(s)` : null,
    edgeCases?.length ? `- **${edgeCases.length}** edge case(s)` : null,
    risks?.length ? `- **${risks.length}** risk(s)` : null,
    "",
    `**Ready to proceed?** Add the \`${config.labels.code}\` label to start the coding pass.`,
    "_Want changes? Leave a comment and I'll refine the description._",
  ]
    .filter(Boolean)
    .join("\n");
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
