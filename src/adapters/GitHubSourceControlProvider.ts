import { getGitHubToken } from "../githubAuth.ts";
import type { ISourceControlProvider } from "../types.ts";

export class GitHubSourceControlProvider implements ISourceControlProvider {
  constructor(private readonly repoFullName: string) {}

  async createDraftPr(
    title: string,
    baseBranch: string,
    featureBranch: string,
    linkedTicket: { platform: string; id: string; url: string }
  ): Promise<string> {
    const body = [
      `Closes ${linkedTicket.url}`,
      "",
      `Implements [${linkedTicket.id}](${linkedTicket.url}).`,
      "",
      "_Scaffolded by AI Ticket Agent_",
    ].join("\n");

    const res = await fetch(`https://api.github.com/repos/${this.repoFullName}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getGitHubToken()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        body,
        head: featureBranch,
        base: baseBranch,
        draft: true,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `GitHub POST /repos/${this.repoFullName}/pulls → ${res.status} ${await res.text()}`
      );
    }

    const pr = (await res.json()) as { html_url: string; number: number };
    console.log(`[GitHubSourceControlProvider] Draft PR #${pr.number} created: ${pr.html_url}`);
    return pr.html_url;
  }
}
