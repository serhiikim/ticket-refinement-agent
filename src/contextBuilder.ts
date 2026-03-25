import type { TicketContext, TicketComment } from "./types.ts";
import type { ClaudeResponse } from "./claudeRunner.ts";

export function buildPrompt(ticket: TicketContext, comments: TicketComment[]): string {
  const commentHistory =
    comments.length > 0
      ? comments
          .map((c) => `**${c.authorLogin}** (${c.createdAt}):\n${c.body}`)
          .join("\n\n---\n\n")
      : "(no comments yet)";

  return `You are an AI assistant analyzing a GitHub issue for a software project.
Your job is to either ask clarifying questions OR enhance the issue with technical detail.

## Rules
- Never assume business logic — ask if unclear
- affectedFiles must be real paths that exist in the codebase (use Read/Glob tools to verify)
- Only ask questions if the code cannot answer them
- Return ONLY valid JSON, no extra text, no markdown fences

## Issue: ${ticket.ticketId}
**Title**: ${ticket.title}

**Body**:
${ticket.body || "(empty)"}

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

export function buildCodingPrompt(
  ticket: TicketContext,
  analysis: ClaudeResponse,
  claudeMdExists: boolean,
  baseBranch?: string
): string {
  const issueNumber = ticket.ticketId.split("#")[1] ?? ticket.ticketId;
  const files = analysis.affectedFiles?.map((f) => `- ${f}`).join("\n") ?? "(none identified)";
  const criteria = analysis.acceptanceCriteria?.map((c) => `- ${c}`).join("\n") ?? "";
  const edgeCases = analysis.edgeCases?.map((e) => `- ${e}`).join("\n") ?? "";

  const claudeMdSection = claudeMdExists
    ? `## CLAUDE.md
Read CLAUDE.md first — it contains architecture context and conventions for this codebase.
After implementing, if your changes introduce a new module, pattern, entity, or architectural decision
that future Claude runs should know about, update CLAUDE.md to reflect it. Only update if the change
is structural — skip for small bug fixes or UI tweaks.`
    : `## CLAUDE.md
No CLAUDE.md exists in this repo yet. After implementing the issue, create one that documents:
- What this project does (1-2 sentences)
- Tech stack and architecture overview
- Key directories and what they contain
- Coding conventions used in this codebase
- Any domain-specific terms a developer needs to know

Keep it concise and factual — it will be read by Claude on every future ticket.`;

  const baseBranchSection = baseBranch
    ? `## Base Branch\nThis implementation branches off \`${baseBranch}\` — not the default branch. The codebase state above reflects that branch.`
    : "";

  return `You are implementing a GitHub issue in an existing codebase.
${baseBranchSection ? `\n${baseBranchSection}\n` : ""}
## Issue #${issueNumber}: ${ticket.title}

${analysis.description ?? ticket.body ?? ""}

## Acceptance Criteria
${criteria}

## Affected Files (already identified)
${files}

## Edge Cases to Handle
${edgeCases}

${claudeMdSection}

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

export function buildResumedCodingPrompt(claudeMdExists: boolean, baseBranch?: string): string {
  const claudeMdSection = claudeMdExists
    ? `## CLAUDE.md
Read CLAUDE.md first — it contains architecture context and conventions for this codebase.
After implementing, update CLAUDE.md only if your changes introduce a new module, pattern, or architectural decision.`
    : `## CLAUDE.md
No CLAUDE.md exists yet. After implementing, create one documenting the project purpose, tech stack, key directories, and coding conventions.`;

  const baseBranchSection = baseBranch
    ? `## Base Branch\nThis implementation branches off \`${baseBranch}\` — not the default branch.`
    : "";

  return `The user has reviewed and approved the ticket analysis above. Please implement the changes now.
${baseBranchSection ? `\n${baseBranchSection}\n` : ""}
${claudeMdSection}

## Instructions
- Implement the changes to satisfy the acceptance criteria from the analysis above
- Follow existing code conventions exactly
- Do not add extra features beyond the issue scope
- Make the code actually work — no TODOs or placeholders

Implement the changes now.`;
}
