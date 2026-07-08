import "../env";
import type { Trigger } from "@hanoman/shared";
import { githubApp } from "./app";
import { prisma } from "../db";
import { fireTrigger } from "../fire-trigger";

// A commit trigger's `detail` reads "push → <branch>" (see App.tsx hint); the
// branch is the segment after the arrow. Plain "main" (no arrow) works too.
function triggerBranch(detail: string): string {
  const parts = detail.split("→");
  return (parts[parts.length - 1] ?? "").trim();
}

// Upsert the installation → repo mapping. `installation` carries `repositories`
// (on create), `installation_repositories` carries `repositories_added`.
async function upsertInstallation(payload: any): Promise<void> {
  const inst = payload.installation;
  if (!inst?.id) return;
  const repos = ((payload.repositories ?? payload.repositories_added ?? []) as Array<{ full_name: string }>)
    .map((r) => r.full_name);
  const account = inst.account?.login ?? inst.account?.name ?? "";
  await prisma.githubInstallation.upsert({
    where: { id: inst.id },
    update: { account, repos },
    create: { id: inst.id, account, repos },
  });
}

// Register handlers once on the App's shared webhook emitter.
let _registered = false;
function ensureHandlers(): void {
  if (_registered) return;
  _registered = true;
  const wh = githubApp().webhooks;

  // push → find the project by repo full_name, fan out its enabled commit
  // triggers whose branch matches the pushed ref.
  wh.on("push", async ({ payload }) => {
    const repo = payload.repository?.full_name;
    const branch = payload.ref?.replace("refs/heads/", "");
    if (!repo || !branch || !payload.ref?.startsWith("refs/heads/")) return;
    const project = await prisma.project.findFirst({ where: { repoUrl: repo } });
    if (!project) return;
    const triggers = await prisma.trigger.findMany({ where: { projectId: project.id, type: "commit", enabled: true } });
    for (const t of triggers) {
      if (triggerBranch(t.detail) !== branch) continue;
      await fireTrigger(t as Trigger, { branch, sha: payload.after, repo, installationId: project.installationId ?? undefined });
    }
  });

  wh.on("installation", async ({ payload }) => upsertInstallation(payload));
  wh.on("installation_repositories", async ({ payload }) => upsertInstallation(payload));
}

// Verify the raw delivery against the webhook secret and dispatch to handlers.
// Throws an AggregateError ("signature does not match ...") on a bad signature;
// the route maps that to 401.
export async function handleWebhook(delivery: { id: string; name: string; signature: string; payload: string }): Promise<void> {
  ensureHandlers();
  await githubApp().webhooks.verifyAndReceive({
    id: delivery.id,
    name: delivery.name as never,
    signature: delivery.signature,
    payload: delivery.payload,
  });
}
