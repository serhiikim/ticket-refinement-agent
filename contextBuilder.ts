import { config } from "./config.ts";
import type { ClaudeResponse } from "./claudeRunner.ts";

interface Issue {
  title: string;
  body: string;
  number: number;
  labels: { name: string }[];
}

interface Comment {
  id: number;
  body: string;
  user: { login: string; type: string };
  created_at: string;
}

export interface IssueContext {
  repoFullName: string;
  issue: Issue;
  comments: Comment[];
}

async function ghFetch<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} → ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function buildContext(
  repoFullName: string,
  issueNumber: number
): Promise<IssueContext> {
  const [issue, comments] = await Promise.all([
    ghFetch<Issue>(`/repos/${repoFullName}/issues/${issueNumber}`),
    ghFetch<Comment[]>(
      `/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=100`
    ),
  ]);

  return { repoFullName, issue, comments };
}

export function buildPrompt(ctx: IssueContext): string {
  const commentHistory =
    ctx.comments.length > 0
      ? ctx.comments
          .map(
            (c) =>
              `**${c.user.login}** (${c.created_at}):\n${c.body}`
          )
          .join("\n\n---\n\n")
      : "(no comments yet)";

  return `You are an AI assistant analyzing a GitHub issue for a software project.
Your job is to either ask clarifying questions OR enhance the issue with technical detail.

## Rules
- Never assume business logic — ask if unclear
- affectedFiles must be real paths that exist in the codebase (use Read/Glob tools to verify)
- Only ask questions if the code cannot answer them
- Return ONLY valid JSON, no extra text, no markdown fences

## Issue: ${ctx.repoFullName}#${ctx.issue.number}
**Title**: ${ctx.issue.title}

**Body**:
${ctx.issue.body || "(empty)"}

## Comment History
${commentHistory}

## Output format

If you need clarification:
\`\`\`
{"action":"clarify","questions":["question 1","question 2"]}
\`\`\`

If you have enough information to enhance:
\`\`\`
{
  "action": "enhance",
  "description": "rewritten issue body in markdown",
  "acceptanceCriteria": ["criterion 1", "criterion 2"],
  "affectedFiles": ["src/path/to/file.ts"],
  "edgeCases": ["edge case 1"],
  "risks": ["risk 1"],
  "createDraftPr": true
}
\`\`\`

Set \`createDraftPr: true\` only when the scope is clear and bounded enough that a developer could start coding immediately. Set it to false for vague tickets, large epics, or anything needing significant design decisions.

Analyze the issue and codebase now, then respond with JSON only.`;
}

export function buildCodingPrompt(ctx: IssueContext, analysis: ClaudeResponse): string {
  const files = analysis.affectedFiles?.map((f) => `- ${f}`).join("\n") ?? "(none identified)";
  const criteria = analysis.acceptanceCriteria?.map((c) => `- ${c}`).join("\n") ?? "";
  const edgeCases = analysis.edgeCases?.map((e) => `- ${e}`).join("\n") ?? "";

  return `You are implementing a GitHub issue in an existing codebase.

## Issue #${ctx.issue.number}: ${ctx.issue.title}

${analysis.description ?? ctx.issue.body ?? ""}

## Acceptance Criteria
${criteria}

## Affected Files (already identified)
${files}

## Edge Cases to Handle
${edgeCases}

## Instructions
- Read the affected files first, understand existing patterns and code style
- Implement the changes to satisfy the acceptance criteria
- Follow the existing code conventions exactly (same formatting, naming, imports)
- Do not add comments unless the logic is genuinely non-obvious
- Do not add extra features beyond what the issue asks for
- Do not modify files unrelated to this issue
- If a file does not exist yet, create it following the project structure
- Make the code actually work — no TODOs, no placeholders

Implement the changes now.`;
}
