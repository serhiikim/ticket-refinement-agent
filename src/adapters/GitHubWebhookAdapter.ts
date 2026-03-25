import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.ts";
import { filterEvent } from "../eventFilter.ts";
import type { IWebhookAdapter, GenericTicketEvent, TriggerReason } from "../types.ts";

// Map internal eventFilter reasons to the public platform-neutral TriggerReason values
const REASON_MAP: Record<string, TriggerReason> = {
  issue_ready: "initial_analysis",
  comment_reply: "clarification_reply",
  refinement_reply: "refinement_reply",
  code_trigger: "code_trigger",
  pr_review: "review_reply",
  issue_closed: "issue_closed",
};

export class GitHubWebhookAdapter implements IWebhookAdapter {
  constructor(private readonly secret: string = config.webhookSecret) {}

  verifySignature(rawBody: string, headers: Record<string, string>): boolean {
    const sig = headers["x-hub-signature-256"] ?? "";
    const expected =
      "sha256=" +
      createHmac("sha256", this.secret).update(rawBody).digest("hex");

    let sigBuf: Buffer, expBuf: Buffer;
    try {
      sigBuf = Buffer.from(sig);
      expBuf = Buffer.from(expected);
    } catch {
      return false;
    }

    return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
  }

  parseEvent(eventType: string, payload: Record<string, unknown>): GenericTicketEvent | null {
    const filter = filterEvent(eventType, payload);
    if (
      !filter.shouldProcess ||
      !filter.reason ||
      !filter.repoFullName ||
      filter.issueNumber == null
    ) {
      return null;
    }

    const triggerReason = REASON_MAP[filter.reason];
    if (!triggerReason) return null;

    return {
      platform: "github",
      triggerReason,
      ticketId: `${filter.repoFullName}#${filter.issueNumber}`,
      repoIdentifier: filter.repoFullName,
    };
  }
}
