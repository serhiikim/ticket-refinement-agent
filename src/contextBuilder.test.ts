import { describe, it, expect } from "vitest";
import { buildPrompt, buildCodingPrompt } from "./contextBuilder.ts";
import type { TicketContext, TicketComment } from "./types.ts";
import type { ClaudeResponse } from "./claudeRunner.ts";

function makeTicket(overrides: Partial<TicketContext> = {}): TicketContext {
  return {
    ticketId: "org/repo#7",
    title: "Fix login bug",
    body: "Users cannot log in after password reset.",
    labels: ["ai-ready"],
    ...overrides,
  };
}

function makeComment(overrides: Partial<TicketComment> = {}): TicketComment {
  return {
    id: "1",
    body: "Can you clarify the scope?",
    authorLogin: "alice",
    authorType: "user",
    isAgentComment: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("includes issue title and body", () => {
    const prompt = buildPrompt(makeTicket(), []);

    expect(prompt).toContain("Fix login bug");
    expect(prompt).toContain("Users cannot log in after password reset.");
    expect(prompt).toContain("org/repo#7");
  });

  it("shows (no comments yet) when there are no comments", () => {
    const prompt = buildPrompt(makeTicket(), []);

    expect(prompt).toContain("(no comments yet)");
  });

  it("includes comment history when comments exist", () => {
    const comments: TicketComment[] = [
      makeComment({
        id: "1",
        body: "Can you clarify the scope?",
        authorLogin: "alice",
        createdAt: "2026-01-01T00:00:00Z",
      }),
      makeComment({
        id: "2",
        body: "Sure, it affects the login page only.",
        authorLogin: "bob",
        createdAt: "2026-01-01T01:00:00Z",
      }),
    ];
    const prompt = buildPrompt(makeTicket(), comments);

    expect(prompt).toContain("alice");
    expect(prompt).toContain("Can you clarify the scope?");
    expect(prompt).toContain("bob");
    expect(prompt).toContain("Sure, it affects the login page only.");
    expect(prompt).not.toContain("(no comments yet)");
  });

  it("includes JSON output format instructions", () => {
    const prompt = buildPrompt(makeTicket(), []);

    expect(prompt).toContain('"action":"clarify"');
    expect(prompt).toContain('"action": "enhance"');
    expect(prompt).toContain("createDraftPr");
  });

  it("handles empty body gracefully", () => {
    const prompt = buildPrompt(makeTicket({ body: "" }), []);

    expect(prompt).toContain("(empty)");
  });
});

describe("buildCodingPrompt", () => {
  it("includes affected files and acceptance criteria", () => {
    const ticket = makeTicket();
    const analysis: ClaudeResponse = {
      action: "enhance",
      description: "Refactored login flow",
      acceptanceCriteria: ["Users can log in after reset", "Password is validated"],
      affectedFiles: ["src/auth/login.ts", "src/auth/reset.ts"],
      edgeCases: ["Expired reset token"],
    };

    const prompt = buildCodingPrompt(ticket, analysis, true);

    expect(prompt).toContain("src/auth/login.ts");
    expect(prompt).toContain("src/auth/reset.ts");
    expect(prompt).toContain("Users can log in after reset");
    expect(prompt).toContain("Password is validated");
    expect(prompt).toContain("Expired reset token");
    expect(prompt).toContain("Issue #7");
  });

  it("handles missing optional fields", () => {
    const ticket = makeTicket();
    const analysis: ClaudeResponse = {
      action: "enhance",
    };

    const prompt = buildCodingPrompt(ticket, analysis, false);

    expect(prompt).toContain("(none identified)");
    expect(prompt).toContain("Issue #7");
  });
});
