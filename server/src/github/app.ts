import "../env";
import { App, Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

// Memoized App from env. Secrets stay server-side; installation tokens are
// minted on demand (installationToken), never persisted.
let _app: App | null = null;
export function githubApp(): App {
  if (_app) return _app;
  const appId = process.env.GITHUB_APP_ID,
    privateKey = process.env.GITHUB_APP_PRIVATE_KEY,
    secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!appId || !privateKey || !secret) throw new Error("GITHUB_APP_ID/PRIVATE_KEY/WEBHOOK_SECRET required");
  _app = new App({ appId, privateKey, webhooks: { secret } });
  return _app;
}

// Installation-scoped Octokit for REST calls (commit status, etc.). `app` is
// injectable so tests can fake GitHub without env/keys.
export async function getInstallationOctokit(installationId: number, app: App = githubApp()): Promise<Octokit> {
  return app.getInstallationOctokit(installationId);
}

// Short-lived installation token for authenticating git remotes (clone/push on
// private repos). Minted per call; callers must not log or persist it.
export async function installationToken(installationId: number): Promise<string> {
  const auth = createAppAuth({ appId: process.env.GITHUB_APP_ID!, privateKey: process.env.GITHUB_APP_PRIVATE_KEY! });
  const { token } = await auth({ type: "installation", installationId });
  return token;
}
