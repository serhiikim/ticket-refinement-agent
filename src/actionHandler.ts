import { config } from "./config.ts";
import type { ClaudeResponse } from "./claudeRunner.ts";

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}


const AGENT_MARKER = "<!-- ai-ticket-agent -->";

async function postComment(repoFullName: string, issueNumber: number, body: string): Promise<void> {
  return ghPost(`/repos/${repoFullName}/issues/${issueNumber}/comments`, {
    body: `${body}\n${AGENT_MARKER}`,
  });
}

async function ghPost(path: string, body: unknown): Promise<void> {
  return withRetry(async () => {
    const res = await fetch(`https://api.github.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`GitHub POST ${path} → ${res.status} ${await res.text()}`);
    }
  });
}

async function ghPostJson<T>(path: string, body: unknown): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(`https://api.github.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`GitHub POST ${path} → ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  });
}



async function ghPatch(path: string, body: unknown): Promise<void> {
  return withRetry(async () => {
  const res = await fetch(`https://api.github.com${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GitHub PATCH ${path} → ${res.status} ${await res.text()}`);
  }
  });
}

async function removeLabel(
  repoFullName: string,
  issueNumber: number,
  label: string
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok && res.status !== 404) {
    console.warn(`[actionHandler] Could not remove label ${label}: ${res.status}`);
  }
}

async function swapLabel(
  repoFullName: string,
  issueNumber: number,
  remove: string,
  add: string
): Promise<void> {
  await ghPost(`/repos/${repoFullName}/issues/${issueNumber}/labels`, { labels: [add] });
  await removeLabel(repoFullName, issueNumber, remove);
}

export async function handleClarify(
  repoFullName: string,
  issueNumber: number,
  response: ClaudeResponse & { action: "clarify" }
): Promise<void> {
  const questions = response.questions ?? [];
  const body = [
    "### Clarifying Questions",
    "",
    "I need a bit more context before I can fully analyze this ticket. Could you help with the following?",
    "",
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    "",
    "_Once answered, I'll pick this up again automatically._",
  ].join("\n");

  await postComment(repoFullName, issueNumber, body);

  await swapLabel(
    repoFullName,
    issueNumber,
    config.labels.ready,
    config.labels.clarifying
  );

  console.log(`[actionHandler] Posted clarifying questions on ${repoFullName}#${issueNumber}`);
}

export async function handleEnhance(
  repoFullName: string,
  issueNumber: number,
  issueTitle: string,
  baseBranch: string,
  response: ClaudeResponse & { action: "enhance" }
): Promise<void> {
  const { description, acceptanceCriteria, affectedFiles, edgeCases, risks } =
    response;

  // Build enhanced issue body
  const sections: string[] = [description ?? ""];

  if (acceptanceCriteria?.length) {
    sections.push(
      "## Acceptance Criteria",
      ...acceptanceCriteria.map((c) => `- [ ] ${c}`)
    );
  }
  if (affectedFiles?.length) {
    sections.push(
      "## Affected Files",
      ...affectedFiles.map((f) => `- \`${f}\``)
    );
  }
  if (edgeCases?.length) {
    sections.push(
      "## Edge Cases",
      ...edgeCases.map((e) => `- ${e}`)
    );
  }
  if (risks?.length) {
    sections.push(
      "## Risks",
      ...risks.map((r) => `- ${r}`)
    );
  }

  sections.push("", "_Enhanced by AI Ticket Agent_");

  const enhancedBody = sections.join("\n\n");

  // Update issue body
  await ghPatch(`/repos/${repoFullName}/issues/${issueNumber}`, {
    body: enhancedBody,
  });

  // Post review comment asking human to approve
  const summary = [
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

  await postComment(repoFullName, issueNumber, summary);

  // Ensure ai-enhanced label is set; remove ai-ready and ai-clarifying if present
  await ghPost(`/repos/${repoFullName}/issues/${issueNumber}/labels`, {
    labels: [config.labels.enhanced],
  });
  await removeLabel(repoFullName, issueNumber, config.labels.ready);
  await removeLabel(repoFullName, issueNumber, config.labels.clarifying);

  console.log(`[actionHandler] Enhanced issue ${repoFullName}#${issueNumber}`);
}

export async function postDraftPrComment(
  repoFullName: string,
  issueNumber: number,
  issueTitle: string,
  baseBranch: string,
  branchName: string,
  analysis: ClaudeResponse & { action: "enhance" }
): Promise<void> {
  const { description, acceptanceCriteria, affectedFiles } = analysis;

  const prBodySections = [
    `Closes #${issueNumber}`,
    "",
    "## Summary",
    description ?? "",
  ];

  if (acceptanceCriteria?.length) {
    prBodySections.push(
      "",
      "## Acceptance Criteria",
      ...acceptanceCriteria.map((c) => `- [ ] ${c}`)
    );
  }

  if (affectedFiles?.length) {
    prBodySections.push(
      "",
      "## Changed Files",
      ...affectedFiles.map((f) => `- \`${f}\``)
    );
  }

  prBodySections.push("", "_Scaffolded by AI Ticket Agent_");

  let prUrl: string;
  try {
    const pr = await ghPostJson<{ html_url: string; number: number }>(
      `/repos/${repoFullName}/pulls`,
      {
        title: issueTitle,
        body: prBodySections.join("\n"),
        head: branchName,
        base: baseBranch,
        draft: true,
      }
    );
    prUrl = pr.html_url;
    console.log(`[actionHandler] Draft PR #${pr.number} created: ${prUrl}`);
  } catch (e) {
    console.warn(`[actionHandler] Draft PR creation failed:`, e);
    return;
  }

  await postComment(repoFullName, issueNumber, `### Draft PR Ready\n\nCode scaffold has been pushed: ${prUrl}`);
}

export async function handleCodingComplete(
  repoFullName: string,
  issueNumber: number
): Promise<void> {
  await swapLabel(repoFullName, issueNumber, config.labels.enhanced, config.labels.done);
  await removeLabel(repoFullName, issueNumber, config.labels.code);
  console.log(`[actionHandler] Marked ${repoFullName}#${issueNumber} as done`);
}
