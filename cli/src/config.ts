import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zHanomanConfig, type HanomanConfig } from "@hanoman/shared";

// Switch guardrail di dashboard tersimpan di baris Setting (Postgres), sementara guardrail
// dijalankan sebagai subprocess `hanoman docs verify` di dalam worktree run — yang tak punya
// akses DB. Worker menurunkannya lewat env; env menang atas hanoman.config.json repo target.
// Env tak diset (CLI dipakai manusia / hook) = konfigurasi repo yang berlaku, seperti dulu.
const bool = (v: string | undefined) => (v === undefined ? undefined : v !== "0" && v !== "false");
const int = (v: string | undefined) => (v === undefined ? undefined : Number(v));

export function loadConfig(
  repoRoot: string,
  env: Record<string, string | undefined> = process.env,
): HanomanConfig {
  const p = join(repoRoot, "hanoman.config.json");
  const raw = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  const over: Partial<HanomanConfig> = {
    requireLinks: bool(env.HANOMAN_REQUIRE_LINKS),
    blockStale: bool(env.HANOMAN_BLOCK_STALE),
    coverageThreshold: int(env.HANOMAN_COVERAGE_THRESHOLD),
  };
  // Spread biasa akan menulis `undefined` dan menghapus nilai dari file (zod lalu memakai
  // default `true`) — jadi kunci yang tak diset harus benar-benar tidak disentuh.
  for (const [k, v] of Object.entries(over)) if (v !== undefined) raw[k] = v;
  return zHanomanConfig.parse(raw);
}
