# Ticket Refinement Agent

A self-hosted webhook server that listens to GitHub issue events and uses Claude Code to automatically analyze, enhance, and scaffold implementation for tickets — grounded in your actual codebase.

## What it does

Add the `ai-ready` label to any GitHub issue and the agent:

1. **Analyzes** — runs Claude Code against your local repo clone, reads real source files
2. **Decides:**
   - **Clarify** — posts numbered questions if the issue is too vague → label becomes `ai-clarifying`
   - **Enhance** — rewrites the issue body with structured description, acceptance criteria, affected files, edge cases, and risks → label becomes `ai-enhanced`
3. **Waits for human review** — after enhancement, you can comment to refine further or add `ai-code` to proceed
4. **Implements** — on `ai-code` label, runs a second Claude Code pass that writes code on a new branch, pushes it, and opens a draft PR

## Label state machine

```
ai-ready → ai-clarifying     needs questions answered; comment to resume
ai-ready → ai-enhanced       description updated; review and refine or approve
ai-enhanced + comment   →    refines description (Claude resumes same session)
ai-enhanced + ai-code   →    coding pass → draft PR → ai-done
```

## Session continuity

Each ticket gets a persistent Claude Code session ID stored in `sessions.json`. Follow-up interactions (comments, label triggers) automatically resume the same session via `--resume`, so Claude has full context of what it previously analyzed without rebuilding the prompt from scratch. Sessions are cleared when the ticket reaches `ai-done`.

## Architecture

```
src/
  index.ts          — Hono server, webhook verification, dedup + per-repo locking, orchestration
  eventFilter.ts    — decides which events trigger processing and why
  contextBuilder.ts — fetches GitHub context, builds analysis + coding prompts
  claudeRunner.ts   — runs Claude Code subprocess (analysis + coding passes, session resume)
  actionHandler.ts  — posts comments, updates issue body, swaps labels, creates draft PRs
  config.ts         — parses all environment variables
  sessions.ts       — persists issueKey → sessionId to disk
  githubAuth.ts     — GitHub App JWT auth with installation token caching
```

## Requirements

- Node.js 18+
- [Claude Code](https://github.com/anthropics/claude-code) installed globally and authenticated
- A GitHub App with **Issues: RW**, **Pull requests: RW**, **Contents: RW** permissions
- An HTTPS endpoint for the GitHub webhook (e.g. nginx reverse proxy)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/serhiikim/ticket-refinement-agent.git
cd ticket-refinement-agent
npm install
```

### 2. Create a GitHub App

In GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**:

- **Homepage URL**: your repo URL
- **Webhook URL**: `https://your-domain.com/webhook/github`
- **Webhook secret**: generate with `openssl rand -hex 32`
- **Repository permissions**: Issues (RW), Pull requests (RW), Contents (RW), Metadata (R)
- **Subscribe to events**: Issues, Issue comment
- **Installation**: Only on this account

After creation:
1. Note the **App ID**
2. Generate and download a **private key** (`.pem`)
3. Install the app on your target repo → note the **Installation ID** from the URL

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
GITHUB_WEBHOOK_SECRET=...          # same secret as in the GitHub App
GITHUB_APP_ID=123456
GITHUB_INSTALLATION_ID=78901234
GITHUB_PRIVATE_KEY_PATH=/path/to/private-key.pem

PORT=3008

# One or more repos: org/repo:/absolute/local/path:branch
REPOS=your-org/your-repo:/home/user/repos/your-repo:main

LABEL_READY=ai-ready
LABEL_CLARIFYING=ai-clarifying
LABEL_ENHANCED=ai-enhanced
LABEL_CODE=ai-code
LABEL_DONE=ai-done
```

### 4. Clone target repos locally

```bash
git clone https://github.com/your-org/your-repo.git /home/user/repos/your-repo
```

### 5. Create labels in your GitHub repo

Create these five labels: `ai-ready`, `ai-clarifying`, `ai-enhanced`, `ai-code`, `ai-done`.

### 6. Start

**Development:**
```bash
npm run dev
```

**Production — systemctl (recommended):**

Create `/etc/systemd/system/ai-ticket-agent.service`:
```ini
[Unit]
Description=AI Ticket Agent
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/agent
ExecStart=/usr/bin/node /path/to/agent/node_modules/.bin/tsx src/index.ts
Restart=on-failure
RestartSec=3
EnvironmentFile=/path/to/agent/.env
Environment="PATH=/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin"

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable ai-ticket-agent
sudo systemctl start ai-ticket-agent
journalctl -u ai-ticket-agent -f
```

### 7. Nginx reverse proxy

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

## Usage

1. Open any issue in your repo
2. Add the `ai-ready` label
3. Within ~60s the agent posts a comment and updates the issue
4. Review the description — comment to refine, or add `ai-code` to trigger implementation
5. A draft PR is created on branch `ai/issue-N-title`

## Auto-deploy

Push to `main` → GitHub Actions SSH into the server, pulls latest, runs `npm ci`, restarts the service. See `.github/workflows/deploy.yml`.
