# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev    # Development mode with hot reload (tsx watch)
npm start      # Run once (production)
npm test       # Run vitest unit tests
npx tsc --noEmit  # Type check without emitting
```

Use `/push` to typecheck + test + commit + push in one step.
Use `/review-docs` after significant changes to check whether CLAUDE.md or README.md need updating.

## Architecture

A Hono webhook server that listens for GitHub issue events and uses Claude Code (subprocess calls) to analyze, enhance, and implement tickets grounded in the actual codebase.

Uses a **Ports & Adapters** design: the core pipeline (`index.ts`) only talks to interfaces defined in `src/types.ts`. Platform-specific logic lives in `src/adapters/`. Adding a new ticket platform means writing a new adapter — no changes to the core pipeline.

**Entry point**: `src/index.ts` — Hono server on port 3008 (default). Responds `202 Accepted` immediately, processes asynchronously. Graceful shutdown on SIGTERM/SIGINT drains in-flight jobs.

**Processing pipeline** (orchestrated in `src/index.ts`):

1. **Webhook received** → `GitHubWebhookAdapter.verifySignature()` checks HMAC-SHA256
2. **`GitHubWebhookAdapter.parseEvent()`** → gates which events trigger processing; maps GitHub payload to `GenericTicketEvent` (see label state machine below)
3. **`ITicketProvider.getTicket()` + `getComments()`** → fetches ticket context; `src/contextBuilder.ts` builds Claude prompts from the returned generic types
4. **`src/claudeRunner.ts`** → runs `claude --print --output-format json` as subprocess; git-resets local repo clone to latest before each run; supports `--resume $sessionId` for session continuity
5. **`ITicketProvider.postComment()` / `updateDescription()` / `updateStatus()`** → posts comments, updates ticket body, transitions workflow state
6. **`ISourceControlProvider.createDraftPr()`** → creates draft PR; returns `{ url, prNumber }` which is posted as a comment
7. **`src/sessions.ts`** → persists `sessionKey → sessionId` to `sessions.json` for cross-webhook session continuity
8. **`src/githubAuth.ts`** → GitHub App JWT auth; generates installation tokens (1hr TTL) with caching

**Key source files:**
- `src/types.ts` — `IWebhookAdapter`, `ITicketProvider`, `ISourceControlProvider`, `GenericTicketEvent`, `TicketContext`, `TicketComment`
- `src/adapters/GitHubWebhookAdapter.ts` — HMAC verify + `filterEvent()` → `GenericTicketEvent`; `secret` injected via constructor (defaults to `config.webhookSecret`)
- `src/adapters/GitHubTicketProvider.ts` — all GitHub Issues API calls; `updateStatus()` maps `"clarifying" | "enhanced" | "done"` to label operations
- `src/adapters/GitHubSourceControlProvider.ts` — GitHub Pulls API; takes `repoFullName` at construction time
- `src/eventFilter.ts` — internal GitHub label state machine; used only by `GitHubWebhookAdapter`
- `src/contextBuilder.ts` — pure prompt builders; takes `TicketContext` + `TicketComment[]` (no GitHub API calls)

**Two-pass Claude execution:**
- Pass 1: `runClaudeCode()` — analysis only, returns JSON `ClaudeResponse`, captures `session_id`
- Pass 2: `runClaudeCodeImplement()` — writes code on a new branch, commits, pushes; uses `--dangerously-skip-permissions`; resumes session if available

**Session continuity:**
- Session key format: `"${platform}:${ticketId}"` e.g. `"github:org/repo#123"`
- First analysis starts a fresh Claude session; `session_id` is stored in `sessions.json`
- All follow-up interactions (`clarification_reply`, `refinement_reply`, `code_trigger`) resume via `--resume $sessionId`
- If session has expired, agent falls back to fresh session automatically
- Session cleared from store after `ai-done`

**Concurrency controls** in `src/index.ts`:
- `processingSet` — deduplicates concurrent events for the same issue (keyed by `"platform:ticketId"`)
- `repoLocks` — serializes Claude runs per repo (promise chain) to prevent git conflicts

**Label state machine (GitHub):**
```
ai-ready      → analysis → ai-enhanced  (description updated, waiting for human review)
ai-ready      → analysis → ai-clarifying (Claude needs more info)
ai-clarifying + comment  → re-run analysis (session resumed)
ai-enhanced   + comment  → refine description (session resumed)
ai-enhanced   + ai-code label → coding pass → ai-pr-prepared
ai-pr-prepared + comment  → review pass → updates PR → ai-pr-prepared
issue closed             → session cleared
```

**Bot identity:** All comments are posted via GitHub App (not PAT), appearing as `your-app[bot]`. Self-loop prevention relies on `user.type === "Bot"` — no HTML marker needed.

## Configuration

All config in `src/config.ts`, driven by environment variables (see `.env.example`):

- `REPOS` — comma-separated `org/repo:/local/path:branch` entries
- `GITHUB_APP_ID` — GitHub App ID
- `GITHUB_INSTALLATION_ID` — Installation ID (from URL after installing app on repo)
- `GITHUB_PRIVATE_KEY_PATH` — path to downloaded `.pem` file
- `GITHUB_WEBHOOK_SECRET` — HMAC secret for payload verification
- `LABEL_READY/CLARIFYING/ENHANCED/CODE/DONE` — customizable label names (defaults: `ai-ready`, `ai-clarifying`, `ai-enhanced`, `ai-code`, `ai-done`)

## Claude Response Schema

```json
{
  "action": "clarify" | "enhance",
  "questions": ["..."],
  "description": "...",
  "acceptanceCriteria": ["..."],
  "affectedFiles": ["src/real/path.ts"],
  "edgeCases": ["..."],
  "risks": ["..."],
  "createDraftPr": true | false
}
```

`affectedFiles` must be real paths verified in the local repo clone.

## Deployment

Production runs via systemctl (`/etc/systemd/system/ai-ticket-agent.service`) with nginx reverse proxy for HTTPS. GitHub Actions (`deploy.yml`) deploys via Tailscale VPN SSH on push to `main`.

The systemd unit needs `Environment="PATH=..."` to include the Node/brew bin directory so the `claude` binary is resolvable.
