import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { GitHubWebhookAdapter } from "./GitHubWebhookAdapter.ts";

const SECRET = "test-webhook-secret";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

function makeIssuePayload(
  action: string,
  labels: { name: string }[] = [],
  addedLabel?: string
) {
  return {
    action,
    label: addedLabel ? { name: addedLabel } : undefined,
    issue: { number: 42, labels },
    repository: { full_name: "org/repo" },
  };
}

function makeCommentPayload(labels: { name: string }[], userType = "User") {
  return {
    action: "created",
    issue: { number: 42, labels },
    comment: { user: { type: userType } },
    repository: { full_name: "org/repo" },
  };
}

describe("GitHubWebhookAdapter", () => {
  const adapter = new GitHubWebhookAdapter(SECRET);

  describe("verifySignature", () => {
    it("returns true for a valid signature", () => {
      const body = JSON.stringify({ action: "labeled" });
      expect(adapter.verifySignature(body, { "x-hub-signature-256": sign(body) })).toBe(true);
    });

    it("returns false for a wrong signature", () => {
      const body = JSON.stringify({ action: "labeled" });
      expect(
        adapter.verifySignature(body, {
          "x-hub-signature-256": "sha256=deadbeefdeadbeefdeadbeefdeadbeef",
        })
      ).toBe(false);
    });

    it("returns false when signature header is missing", () => {
      const body = JSON.stringify({ action: "labeled" });
      expect(adapter.verifySignature(body, {})).toBe(false);
    });

    it("returns false when body is tampered after signing", () => {
      const originalBody = JSON.stringify({ action: "labeled" });
      const tamperedBody = JSON.stringify({ action: "deleted" });
      expect(
        adapter.verifySignature(tamperedBody, { "x-hub-signature-256": sign(originalBody) })
      ).toBe(false);
    });
  });

  describe("parseEvent — TriggerReason mapping", () => {
    it("maps issue_ready → initial_analysis", () => {
      const event = adapter.parseEvent(
        "issues",
        makeIssuePayload("labeled", [{ name: "ai-ready" }])
      );
      expect(event?.triggerReason).toBe("initial_analysis");
    });

    it("maps comment_reply → clarification_reply", () => {
      const event = adapter.parseEvent(
        "issue_comment",
        makeCommentPayload([{ name: "ai-clarifying" }])
      );
      expect(event?.triggerReason).toBe("clarification_reply");
    });

    it("maps refinement_reply → refinement_reply", () => {
      const event = adapter.parseEvent(
        "issue_comment",
        makeCommentPayload([{ name: "ai-enhanced" }])
      );
      expect(event?.triggerReason).toBe("refinement_reply");
    });

    it("maps code_trigger → code_trigger", () => {
      const event = adapter.parseEvent(
        "issues",
        makeIssuePayload("labeled", [{ name: "ai-enhanced" }], "ai-code")
      );
      expect(event?.triggerReason).toBe("code_trigger");
    });

    it("maps pr_review → review_reply", () => {
      const event = adapter.parseEvent(
        "issue_comment",
        makeCommentPayload([{ name: "ai-pr-prepared" }])
      );
      expect(event?.triggerReason).toBe("review_reply");
    });

    it("maps issue_closed → issue_closed", () => {
      const event = adapter.parseEvent(
        "issues",
        makeIssuePayload("closed", [])
      );
      expect(event?.triggerReason).toBe("issue_closed");
    });
  });

  describe("parseEvent — GenericTicketEvent shape", () => {
    it("sets platform to 'github'", () => {
      const event = adapter.parseEvent(
        "issues",
        makeIssuePayload("labeled", [{ name: "ai-ready" }])
      );
      expect(event?.platform).toBe("github");
    });

    it("builds ticketId as 'repoFullName#issueNumber'", () => {
      const event = adapter.parseEvent(
        "issues",
        makeIssuePayload("labeled", [{ name: "ai-ready" }])
      );
      expect(event?.ticketId).toBe("org/repo#42");
    });

    it("sets repoIdentifier to the repo full name", () => {
      const event = adapter.parseEvent(
        "issues",
        makeIssuePayload("labeled", [{ name: "ai-ready" }])
      );
      expect(event?.repoIdentifier).toBe("org/repo");
    });

    it("returns a fully shaped GenericTicketEvent", () => {
      const event = adapter.parseEvent(
        "issues",
        makeIssuePayload("labeled", [{ name: "ai-ready" }])
      );
      expect(event).toEqual({
        platform: "github",
        triggerReason: "initial_analysis",
        ticketId: "org/repo#42",
        repoIdentifier: "org/repo",
      });
    });
  });

  describe("parseEvent — ignored events", () => {
    it("returns null for unknown event types", () => {
      expect(adapter.parseEvent("push", {})).toBeNull();
      expect(adapter.parseEvent("pull_request", { action: "opened" })).toBeNull();
    });

    it("returns null when issue has no matching label", () => {
      expect(
        adapter.parseEvent("issues", makeIssuePayload("labeled", [{ name: "bug" }]))
      ).toBeNull();
    });

    it("returns null for bot comments", () => {
      expect(
        adapter.parseEvent("issue_comment", makeCommentPayload([{ name: "ai-clarifying" }], "Bot"))
      ).toBeNull();
    });

    it("returns null for non-created comment actions", () => {
      const payload = { ...makeCommentPayload([{ name: "ai-clarifying" }]), action: "edited" };
      expect(adapter.parseEvent("issue_comment", payload)).toBeNull();
    });
  });
});
