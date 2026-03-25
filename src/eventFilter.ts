import { config } from "./config.ts";

export type TriggerReason = "issue_ready" | "comment_reply" | "refinement_reply" | "code_trigger" | "pr_review" | "issue_closed";

export interface FilterResult {
  shouldProcess: boolean;
  reason?: TriggerReason;
  repoFullName?: string;
  issueNumber?: number;
}

export function filterEvent(
  eventType: string,
  payload: Record<string, unknown>
): FilterResult {
  const no: FilterResult = { shouldProcess: false };

  if (eventType === "issues") {
    const action = payload.action as string;
    const issue = payload.issue as Record<string, unknown>;
    const repo = payload.repository as Record<string, unknown>;

    // Issue closed → clear session (no Claude run)
    if (action === "closed") {
      return {
        shouldProcess: true,
        reason: "issue_closed",
        repoFullName: repo.full_name as string,
        issueNumber: issue.number as number,
      };
    }

    // ai-code label just added → trigger coding pass
    if (action === "labeled") {
      const addedLabel = (payload.label as { name: string } | undefined)?.name;
      if (addedLabel === config.labels.code) {
        return {
          shouldProcess: true,
          reason: "code_trigger",
          repoFullName: repo.full_name as string,
          issueNumber: issue.number as number,
        };
      }
    }

    // ai-ready label present → trigger analysis
    if (["opened", "edited", "labeled"].includes(action)) {
      const labels = (issue.labels as { name: string }[]) ?? [];
      if (labels.some((l) => l.name === config.labels.ready)) {
        return {
          shouldProcess: true,
          reason: "issue_ready",
          repoFullName: repo.full_name as string,
          issueNumber: issue.number as number,
        };
      }
    }

    return no;
  }

  if (eventType === "issue_comment") {
    const action = payload.action as string;
    if (action !== "created") return no;

    const issue = payload.issue as Record<string, unknown>;
    const labels = (issue.labels as { name: string }[]) ?? [];
    const comment = payload.comment as Record<string, unknown>;
    const sender = (comment.user as { type: string } | undefined)?.type;
    if (sender === "Bot") return no;

    const repo = payload.repository as Record<string, unknown>;

    // Comment on ai-clarifying → resume analysis
    if (labels.some((l) => l.name === config.labels.clarifying)) {
      return {
        shouldProcess: true,
        reason: "comment_reply",
        repoFullName: repo.full_name as string,
        issueNumber: issue.number as number,
      };
    }

    // Comment on ai-enhanced → refine description
    if (labels.some((l) => l.name === config.labels.enhanced)) {
      return {
        shouldProcess: true,
        reason: "refinement_reply",
        repoFullName: repo.full_name as string,
        issueNumber: issue.number as number,
      };
    }

    // Comment on ai-pr-prepared → review pass
    if (labels.some((l) => l.name === config.labels.prPrepared)) {
      return {
        shouldProcess: true,
        reason: "pr_review",
        repoFullName: repo.full_name as string,
        issueNumber: issue.number as number,
      };
    }

    return no;
  }

  return no;
}
