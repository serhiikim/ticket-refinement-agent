import "dotenv/config";

// REPOS format: "org/repo:/local/path:branch,org/repo2:/local/path2:main"
function parseRepos(raw: string | undefined): Record<string, { localPath: string; branch: string }> {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(",").map((entry) => {
      const [fullName, localPath, branch = "main"] = entry.trim().split(":");
      return [fullName, { localPath, branch }];
    })
  );
}

export const config = {
  port: parseInt(process.env.PORT ?? "3008"),
  githubToken: process.env.GITHUB_TOKEN!,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
  repos: parseRepos(process.env.REPOS),
  labels: {
    ready: process.env.LABEL_READY ?? "ai-ready",
    clarifying: process.env.LABEL_CLARIFYING ?? "ai-clarifying",
    enhanced: process.env.LABEL_ENHANCED ?? "ai-enhanced",
    code: process.env.LABEL_CODE ?? "ai-code",
    done: process.env.LABEL_DONE ?? "ai-done",
  },
};
