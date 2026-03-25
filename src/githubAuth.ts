import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

let cachedToken: string | null = null;
let tokenExpiresAt: Date | null = null;

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function generateJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iat: now - 60, // 60s back to account for clock drift
    exp: now + 600, // 10 min max for GitHub App JWTs
    iss: appId,
  }));
  const data = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  return `${data}.${sign.sign(privateKey, "base64url")}`;
}

async function fetchInstallationToken(
  appId: string,
  privateKey: string,
  installationId: string
): Promise<{ token: string; expiresAt: Date }> {
  const jwt = generateJWT(appId, privateKey);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) {
    throw new Error(`GitHub App token fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json() as { token: string; expires_at: string };
  return { token: data.token, expiresAt: new Date(data.expires_at) };
}

export async function getGitHubToken(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) {
    // Fall back to static PAT (backward compat)
    return process.env.GITHUB_TOKEN!;
  }

  // Return cached token if still valid with a 1 min buffer
  if (cachedToken && tokenExpiresAt && tokenExpiresAt > new Date(Date.now() + 60_000)) {
    return cachedToken;
  }

  const privateKey = readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH!, "utf8");
  const installationId = process.env.GITHUB_INSTALLATION_ID!;
  const { token, expiresAt } = await fetchInstallationToken(appId, privateKey, installationId);

  cachedToken = token;
  tokenExpiresAt = expiresAt;
  console.log(`[githubAuth] Installation token refreshed, expires ${expiresAt.toISOString()}`);
  return token;
}
