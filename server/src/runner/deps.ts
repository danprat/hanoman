import { spawnSync } from "node:child_process";
import { realGit, type RunDeps, type SdkMessage } from "@hanoman/runner";
// Settings store effort as "xhigh"; keep "x-high" as an alias for hand-written config.
const THINK: Record<string, number | undefined> = { xhigh: 32000, "x-high": 32000, high: 16000, medium: 8000, low: 2000 };
export function verifyViaCli(cwd: string) {
  const r = spawnSync("node", [`${process.cwd()}/cli/dist/hanoman.js`, "docs", "verify", "--block-if-stale", "--json"], { cwd, encoding: "utf8" });
  if (r.status === 0) return { blocked: false };
  try { const j = JSON.parse(r.stdout); return { blocked: true, reason: j.violations?.map((v: any) => v.reason).join("; ") }; }
  catch { return { blocked: true, reason: "docs verify blocked" }; }
}
export const prodDeps: RunDeps = {
  // lazy import: the SDK loads only when a real run iterates the query, so unit
  // tests (which inject fake deps) never touch it and spend no tokens.
  queryFn: (a) => (async function* () {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    for await (const m of query(a as any) as AsyncIterable<unknown>) yield m as SdkMessage;
  })(),
  git: realGit, verify: verifyViaCli,
  effortToThinking: (effort) => THINK[effort],
};
