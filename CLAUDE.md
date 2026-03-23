# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev    # Development mode with hot reload (tsx watch)
npm start      # Run once (production)
```

No test suite exists. Manual testing is done via GitHub webhook delivery replays.

## Architecture

A Hono webhook server that listens for GitHub issue events and uses Claude Code (subprocess calls) to analyze and enhance tickets grounded in the actual codebase.

**Entry point**: `index.ts` — Hono server on port 3008 (default). Responds `202 Accepted` immediately, processes asynchronously.

**Processing pipeline** (orchestrated in `index.ts`):

1. **Webhook received** → HMAC-SHA256 signature verified
2. **`eventFilter.ts`** → Gates which events trigger processing:
   - `issues` (opened/edited/labeled) with `ai-ready` label → `"issue_ready"`
   - `issue_comment` (created) on issues with `ai-clarifying` label, not from bot → `"comment_reply"`
3. **`contextBuilder.ts`** → Fetches issue + all comments from GitHub API, builds Claude prompt
4. **`claudeRunner.ts`** → Runs `claude --print --output-format json` as subprocess; git-resets local repo clone to latest before each run
5. **`actionHandler.ts`** → Posts comments, swaps labels, patches issue body, optionally creates draft PRs

**Two-pass Claude execution** (when `createDraftPr: true` in analysis response):
- Pass 1: `runClaudeCode()` — analysis only, returns JSON
- Pass 2: `runClaudeCodeImplement()` — writes code on a new branch, commits, pushes; uses `--dangerously-skip-permissions`

**Concurrency controls** in `index.ts`:
- `processingSet` — deduplicates concurrent events for the same issue
- `repoLocks` — serializes Claude runs per repo (promise chain) to prevent git conflicts

**Label state machine**:
- `ai-ready` → trigger analysis
- `ai-clarifying` → waiting for human clarification (bot asked questions)
- `ai-done` → processing complete

## Configuration

All config in `config.ts`, driven by environment variables (see `.env.example`):

- `REPOS` — comma-separated `org/repo:/local/path:branch` entries; each repo needs a local clone that Claude reads
- `GITHUB_TOKEN` — fine-grained PAT (Issues RW, PRs RW, Contents RW)
- `GITHUB_WEBHOOK_SECRET` — HMAC secret for payload verification
- `LABEL_READY/CLARIFYING/DONE` — customizable label names

## Claude Response Schema

Claude analysis pass must return JSON matching this shape:

```json
{
  "action": "clarify" | "enhance",
  "questions": ["..."],          // if clarify
  "description": "...",          // if enhance
  "acceptanceCriteria": ["..."],
  "affectedFiles": ["src/real/path.ts"],
  "edgeCases": ["..."],
  "risks": ["..."],
  "createDraftPr": true | false
}
```

`affectedFiles` must be real paths verified in the local repo clone — Claude is prompted to check they exist.

## Deployment

Production runs via systemctl (`/etc/systemd/system/ai-ticket-agent.service`) with nginx reverse proxy for HTTPS. PM2 config (`ecosystem.config.cjs`) is an alternative. GitHub Actions (`deploy.yml`) deploys via Tailscale VPN SSH on push to `main`.
