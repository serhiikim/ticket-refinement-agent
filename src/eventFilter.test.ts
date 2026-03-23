import { describe, it, expect } from "vitest";
import { filterEvent } from "./eventFilter.ts";

function makeIssuePayload(action: string, labels: { name: string }[] = []) {
  return {
    action,
    issue: {
      number: 42,
      labels,
    },
    repository: {
      full_name: "org/repo",
    },
  };
}

function makeCommentPayload(
  labels: { name: string }[],
  userType: string = "User"
) {
  return {
    action: "created",
    issue: {
      number: 42,
      labels,
    },
    comment: {
      user: { type: userType },
    },
    repository: {
      full_name: "org/repo",
    },
  };
}

describe("filterEvent", () => {
  describe("issues event", () => {
    it("triggers on labeled action with ai-ready label", () => {
      const result = filterEvent(
        "issues",
        makeIssuePayload("labeled", [{ name: "ai-ready" }])
      );
      expect(result).toEqual({
        shouldProcess: true,
        reason: "issue_ready",
        repoFullName: "org/repo",
        issueNumber: 42,
      });
    });

    it("triggers on opened action with ai-ready label", () => {
      const result = filterEvent(
        "issues",
        makeIssuePayload("opened", [{ name: "ai-ready" }])
      );
      expect(result.shouldProcess).toBe(true);
      expect(result.reason).toBe("issue_ready");
    });

    it("triggers on edited action with ai-ready label", () => {
      const result = filterEvent(
        "issues",
        makeIssuePayload("edited", [{ name: "ai-ready" }])
      );
      expect(result.shouldProcess).toBe(true);
    });

    it("skips issues without ai-ready label", () => {
      const result = filterEvent(
        "issues",
        makeIssuePayload("labeled", [{ name: "bug" }])
      );
      expect(result.shouldProcess).toBe(false);
    });

    it("skips unsupported actions like closed", () => {
      const result = filterEvent(
        "issues",
        makeIssuePayload("closed", [{ name: "ai-ready" }])
      );
      expect(result.shouldProcess).toBe(false);
    });

    it("skips unsupported actions like deleted", () => {
      const result = filterEvent(
        "issues",
        makeIssuePayload("deleted", [{ name: "ai-ready" }])
      );
      expect(result.shouldProcess).toBe(false);
    });
  });

  describe("issue_comment event", () => {
    it("triggers on comment with ai-clarifying label from non-bot user", () => {
      const result = filterEvent(
        "issue_comment",
        makeCommentPayload([{ name: "ai-clarifying" }], "User")
      );
      expect(result).toEqual({
        shouldProcess: true,
        reason: "comment_reply",
        repoFullName: "org/repo",
        issueNumber: 42,
      });
    });

    it("skips comments from Bot users", () => {
      const result = filterEvent(
        "issue_comment",
        makeCommentPayload([{ name: "ai-clarifying" }], "Bot")
      );
      expect(result.shouldProcess).toBe(false);
    });

    it("skips comments without ai-clarifying label", () => {
      const result = filterEvent(
        "issue_comment",
        makeCommentPayload([{ name: "ai-ready" }], "User")
      );
      expect(result.shouldProcess).toBe(false);
    });

    it("skips non-created comment actions", () => {
      const payload = makeCommentPayload(
        [{ name: "ai-clarifying" }],
        "User"
      );
      payload.action = "edited";
      const result = filterEvent("issue_comment", payload);
      expect(result.shouldProcess).toBe(false);
    });
  });

  describe("unknown events", () => {
    it("skips pull_request events", () => {
      const result = filterEvent("pull_request", { action: "opened" });
      expect(result.shouldProcess).toBe(false);
    });

    it("skips push events", () => {
      const result = filterEvent("push", {});
      expect(result.shouldProcess).toBe(false);
    });
  });
});
