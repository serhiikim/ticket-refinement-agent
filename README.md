# Ticket Refinement Agent

A self-hosted webhook server that listens to GitHub issue events and uses Claude Code to automatically analyze, enhance, and scaffold implementation for tickets.

## What it does

When you add the `ai-ready` label to a GitHub issue, the agent:

1. **Fetches context** — pulls the issue body, full comment history
2. **Runs Claude Code** against your local repo clone — reads actual source files to ground its analysis
3. **Decides what to do:**
   - **Clarify** — if the issue is too vague, posts numbered questions as a comment and swaps the label to `ai-clarifying`. When a human replies, the agent picks it back up automatically.
   - **Enhance** — rewrites the issue body with a structured description, acceptance criteria, affected files (real paths verified in the codebase), edge cases, and risks. Swaps label to `ai-done`.
4. **Optionally creates a draft PR** — if the scope is clear enough to start coding, runs a second Claude Code pass that actually implements the changes on a new branch (`ai/issue-N-title`), pushes it, and opens a draft PR linked to the issue.

## Label state machine

```
ai-ready → ai-clarifying   (needs questions answered)
ai-ready → ai-done         (ticket enhanced)
ai-clarifying → ai-done    (human replied, agent re-ran)
```

## Architecture

```
/agent
  index.ts          — Hono server, webhook signature verification, dedup + per-repo locking
  eventFilter.ts    — decides which events trigger processing
  contextBuilder.ts — fetches GitHub context, builds analysis + coding prompts
  claudeRunner.ts   — runs Claude Code for analysis and code implementation
  actionHandler.ts  — posts comments, updates issue body, swaps labels, creates draft PRs
  config.ts         — parses environment variables including multi-repo config
```

## Requirements

- Node.js 18+
- [Claude Code](https://github.com/anthropics/claude-code) installed globally (`npm install -g @anthropic-ai/claude-code`) and authenticated
- A GitHub fine-grained PAT with **Issues: Read/Write**, **Pull requests: Read/Write**, **Contents: Read/Write** on the target repos
- An HTTPS endpoint (e.g. via nginx reverse proxy) for the GitHub webhook

## Setup

### 1. Clone and install

```bash
git clone https://github.com/serhiikim/ticket-refinement-agent.git
cd ticket-refinement-agent
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
GITHUB_TOKEN=ghp_...          # Fine-grained PAT
GITHUB_WEBHOOK_SECRET=...     # Generate with: openssl rand -hex 32
PORT=3008

# One or more repos: org/repo:/absolute/local/path:branch
REPOS=your-org/your-repo:/home/user/repos/your-repo:main

LABEL_READY=ai-ready
LABEL_CLARIFYING=ai-clarifying
LABEL_DONE=ai-done
```

Multiple repos:
```bash
REPOS=org/repo-a:/home/user/repos/repo-a:main,org/repo-b:/home/user/repos/repo-b:develop
```

### 3. Clone target repos locally

The agent needs a local clone of each repo it analyzes. Claude Code reads the actual source files during analysis.

```bash
git clone https://github.com/your-org/your-repo.git /home/user/repos/your-repo
```

### 4. Start

```bash
npm start          # production
npm run dev        # watch mode
```

### 5. Nginx reverse proxy

Add to your server block:

```nginx
location /webhook/github {
    proxy_pass http://127.0.0.1:3008;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 10s;
}

location /health {
    proxy_pass http://127.0.0.1:3008;
}
```

### 6. GitHub webhook

In your repo → **Settings → Webhooks → Add webhook**:

| Field | Value |
|---|---|
| Payload URL | `https://your-domain.com/webhook/github` |
| Content type | `application/json` |
| Secret | Same value as `GITHUB_WEBHOOK_SECRET` |
| Events | Issues, Issue comments |

### 7. Create labels

Create these three labels in your GitHub repo: `ai-ready`, `ai-clarifying`, `ai-done`.

### 8. Run with PM2 (optional)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

## Usage

1. Open any issue in your repo
2. Add the `ai-ready` label
3. The agent analyzes the codebase and either asks questions or enhances the ticket within ~60 seconds
4. If a draft PR is created, check out the branch and continue from there

## GitHub token permissions

Create a **fine-grained personal access token** scoped to your target repos:

- `Issues` → Read and Write
- `Pull requests` → Read and Write
- `Contents` → Read and Write
- `Metadata` → Read-only (auto-selected)
