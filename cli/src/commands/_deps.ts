import { realGit, type RunDeps, type SdkMessage } from "@hanoman/runner";
import { collectViolations } from "../verify";
// Settings store effort as "xhigh"; keep "x-high" as an alias for hand config.
const THINK: Record<string, number | undefined> = { xhigh: 32000, "x-high": 32000, high: 16000, medium: 8000, low: 2000 };
// CLI runs in-process, so the guardrail reuses collectViolations directly
// instead of shelling out to `hanoman docs verify`.
export const prodDeps: RunDeps = {
  queryFn: (a) => (async function* () {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    for await (const m of query(a as any) as AsyncIterable<unknown>) yield m as SdkMessage;
  })(),
  git: realGit,
  verify: (cwd) => {
    const { violations } = collectViolations(cwd);
    return violations.length ? { blocked: true, reason: violations.map((v) => v.reason).join("; ") } : { blocked: false };
  },
  effortToThinking: (effort) => THINK[effort],
};
