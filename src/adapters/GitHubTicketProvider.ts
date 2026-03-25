import { config } from "../config.ts";
import { getGitHubToken } from "../githubAuth.ts";
import type { ITicketProvider, TicketContext, TicketComment } from "../types.ts";

export class GitHubTicketProvider implements ITicketProvider {
  /** Parse "org/repo#123" into its parts */
  private parseId(id: string): { repoFullName: string; issueNumber: number } {
    const hashIdx = id.indexOf("#");
    return {
      repoFullName: id.slice(0, hashIdx),
      issueNumber: parseInt(id.slice(hashIdx + 1)),
    };
  }

  private async ghFetch<T>(path: string): Promise<T> {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${await getGitHubToken()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${path} → ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1500): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
    throw lastErr;
  }

  private async ghPost(path: string, body: unknown): Promise<void> {
    return this.withRetry(async () => {
      const res = await fetch(`https://api.github.com${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await getGitHubToken()}`,
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

  private async ghPatch(path: string, body: unknown): Promise<void> {
    return this.withRetry(async () => {
      const res = await fetch(`https://api.github.com${path}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${await getGitHubToken()}`,
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

  private async removeLabel(repoFullName: string, issueNumber: number, label: string): Promise<void> {
    const res = await fetch(
      `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${await getGitHubToken()}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!res.ok && res.status !== 404) {
      console.warn(`[GitHubTicketProvider] Could not remove label "${label}": ${res.status}`);
    }
  }

  private async swapLabel(
    repoFullName: string,
    issueNumber: number,
    remove: string,
    add: string
  ): Promise<void> {
    await this.ghPost(`/repos/${repoFullName}/issues/${issueNumber}/labels`, { labels: [add] });
    await this.removeLabel(repoFullName, issueNumber, remove);
  }

  async getTicket(id: string): Promise<TicketContext> {
    const { repoFullName, issueNumber } = this.parseId(id);
    const issue = await this.ghFetch<{
      title: string;
      body: string | null;
      number: number;
      labels: { name: string }[];
    }>(`/repos/${repoFullName}/issues/${issueNumber}`);
    return {
      ticketId: id,
      title: issue.title,
      body: issue.body ?? "",
      labels: issue.labels.map((l) => l.name),
    };
  }

  async getComments(id: string): Promise<TicketComment[]> {
    const { repoFullName, issueNumber } = this.parseId(id);
    const raw = await this.ghFetch<
      { id: number; body: string; user: { login: string; type: string }; created_at: string }[]
    >(`/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=100`);
    return raw.map((c) => ({
      id: String(c.id),
      body: c.body,
      authorLogin: c.user.login,
      authorType: c.user.type === "Bot" ? "bot" : "user",
      isAgentComment: c.user.type === "Bot",
      createdAt: c.created_at,
    }));
  }

  async postComment(id: string, body: string): Promise<void> {
    const { repoFullName, issueNumber } = this.parseId(id);
    await this.ghPost(`/repos/${repoFullName}/issues/${issueNumber}/comments`, { body });
  }

  async updateDescription(id: string, newBody: string): Promise<void> {
    const { repoFullName, issueNumber } = this.parseId(id);
    await this.ghPatch(`/repos/${repoFullName}/issues/${issueNumber}`, { body: newBody });
  }

  async updateStatus(id: string, status: "clarifying" | "enhanced" | "done" | "pr-prepared"): Promise<void> {
    const { repoFullName, issueNumber } = this.parseId(id);
    if (status === "clarifying") {
      await this.swapLabel(repoFullName, issueNumber, config.labels.ready, config.labels.clarifying);
    } else if (status === "enhanced") {
      await this.ghPost(`/repos/${repoFullName}/issues/${issueNumber}/labels`, {
        labels: [config.labels.enhanced],
      });
      await this.removeLabel(repoFullName, issueNumber, config.labels.ready);
      await this.removeLabel(repoFullName, issueNumber, config.labels.clarifying);
    } else if (status === "done") {
      await this.swapLabel(repoFullName, issueNumber, config.labels.enhanced, config.labels.done);
      await this.removeLabel(repoFullName, issueNumber, config.labels.code);
    } else if (status === "pr-prepared") {
      await this.ghPost(`/repos/${repoFullName}/issues/${issueNumber}/labels`, {
        labels: [config.labels.prPrepared],
      });
      await this.removeLabel(repoFullName, issueNumber, config.labels.enhanced);
      await this.removeLabel(repoFullName, issueNumber, config.labels.code);
      await this.removeLabel(repoFullName, issueNumber, config.labels.clarifying);
    }
  }
}
