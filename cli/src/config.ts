import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zHanomanConfig, type HanomanConfig } from "@hanoman/shared";
// Hanya membaca `docsDir` (dipakai resolveRepo + server/services/scan). Knob guardrail
// (requireLinks/blockStale/coverageThreshold) dan override env dicabut, SPEC-160.
export function loadConfig(repoRoot: string): HanomanConfig {
  const p = join(repoRoot, "hanoman.config.json");
  const raw = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  return zHanomanConfig.parse(raw);
}
