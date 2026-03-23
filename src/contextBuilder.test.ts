import { describe, it, expect } from "vitest";
import { buildPrompt, buildCodingPrompt, type IssueContext } from "./contextBuilder.ts";
import type { ClaudeResponse } from "./claudeRunner.ts";

function makeContext(overrides: Partial<IssueContext> = {}): IssueContext {
  return {
    repoFullName: "org/repo",
    issue: {
      title: "Fix login bug",
      body: "Users cannot log in after password reset.",
      number: 7,
      labels: [{ name: "ai-ready" }],
    },
    comments: [],
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("includes issue title and body", () => {
    const ctx = makeContext();
    const prompt = buildPrompt(ctx);

    expect(prompt).toContain("Fix login bug");
    expect(prompt).toContain("Users cannot log in after password reset.");
    expect(prompt).toContain("org/repo#7");
  });

  it("shows (no comments yet) when there are no comments", () => {
    const ctx = makeContext({ comments: [] });
    const prompt = buildPrompt(ctx);

    expect(prompt).toContain("(no comments yet)");
  });

  it("includes comment history when comments exist", () => {
    const ctx = makeContext({
      comments: [
        {
          id: 1,
          body: "Can you clarify the scope?",
          user: { login: "alice", type: "User" },
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          body: "Sure, it affects the login page only.",
          user: { login: "bob", type: "User" },
          created_at: "2026-01-01T01:00:00Z",
        },
      ],
    });
    const prompt = buildPrompt(ctx);

    expect(prompt).toContain("alice");
    expect(prompt).toContain("Can you clarify the scope?");
    expect(prompt).toContain("bob");
    expect(prompt).toContain("Sure, it affects the login page only.");
    expect(prompt).not.toContain("(no comments yet)");
  });

  it("includes JSON output format instructions", () => {
    const prompt = buildPrompt(makeContext());

    expect(prompt).toContain('"action":"clarify"');
    expect(prompt).toContain('"action": "enhance"');
    expect(prompt).toContain("createDraftPr");
  });

  it("handles empty body gracefully", () => {
    const ctx = makeContext({
      issue: { title: "Empty", body: "", number: 1, labels: [] },
    });
    const prompt = buildPrompt(ctx);

    expect(prompt).toContain("(empty)");
  });
});

describe("buildCodingPrompt", () => {
  it("includes affected files and acceptance criteria", () => {
    const ctx = makeContext();
    const analysis: ClaudeResponse = {
      action: "enhance",
      description: "Refactored login flow",
      acceptanceCriteria: ["Users can log in after reset", "Password is validated"],
      affectedFiles: ["src/auth/login.ts", "src/auth/reset.ts"],
      edgeCases: ["Expired reset token"],
    };

    const prompt = buildCodingPrompt(ctx, analysis);

    expect(prompt).toContain("src/auth/login.ts");
    expect(prompt).toContain("src/auth/reset.ts");
    expect(prompt).toContain("Users can log in after reset");
    expect(prompt).toContain("Password is validated");
    expect(prompt).toContain("Expired reset token");
    expect(prompt).toContain("Issue #7");
  });

  it("handles missing optional fields", () => {
    const ctx = makeContext();
    const analysis: ClaudeResponse = {
      action: "enhance",
    };

    const prompt = buildCodingPrompt(ctx, analysis);

    expect(prompt).toContain("(none identified)");
    expect(prompt).toContain("Issue #7");
  });
});
