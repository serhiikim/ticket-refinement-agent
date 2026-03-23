import { config } from "./config.ts";

export type TriggerReason = "issue_ready" | "comment_reply";

export interface FilterResult {
  shouldProcess: boolean;
  reason?: TriggerReason;
  repoFullName?: string;
  issueNumber?: number;
  installationLogin?: string;
}

export function filterEvent(
  eventType: string,
  payload: Record<string, unknown>
): FilterResult {
  const no: FilterResult = { shouldProcess: false };

  if (eventType === "issues") {
    const action = payload.action as string;
    if (!["opened", "edited", "labeled"].includes(action)) return no;

    const issue = payload.issue as Record<string, unknown>;
    const labels = (issue.labels as { name: string }[]) ?? [];
    const hasReady = labels.some((l) => l.name === config.labels.ready);
    if (!hasReady) return no;

    const repo = payload.repository as Record<string, unknown>;
    return {
      shouldProcess: true,
      reason: "issue_ready",
      repoFullName: repo.full_name as string,
      issueNumber: issue.number as number,
    };
  }

  if (eventType === "issue_comment") {
    const action = payload.action as string;
    if (action !== "created") return no;

    const issue = payload.issue as Record<string, unknown>;
    const labels = (issue.labels as { name: string }[]) ?? [];
    const hasClarifying = labels.some(
      (l) => l.name === config.labels.clarifying
    );
    if (!hasClarifying) return no;

    // Skip comments from ourselves (bot)
    const comment = payload.comment as Record<string, unknown>;
    const sender = (comment.user as { type: string } | undefined)?.type;
    if (sender === "Bot") return no;

    const repo = payload.repository as Record<string, unknown>;
    return {
      shouldProcess: true,
      reason: "comment_reply",
      repoFullName: repo.full_name as string,
      issueNumber: issue.number as number,
    };
  }

  return no;
}
