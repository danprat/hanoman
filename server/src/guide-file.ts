// SPEC-489 · naskah panduan AI agent (`docs/agent-integration.md`) disajikan MENTAH lewat
// `GET /api/agent-integration.md`. Ia berada di dua tempat, persis seperti aset dashboard:
// `docs/` di dalam paket npm (bersebelahan dengan `dist`) atau `docs/` di root checkout.
// Murni supaya bisa dites tanpa filesystem; cermin `web-dir.ts`.
import { resolve } from "node:path";
import type { EnvLike } from "@hanoman/runner";

/** Path naskah relatif terhadap root paket / root checkout. Satu definisi untuk server & pack. */
export const AGENT_DOC_REL = "docs/agent-integration.md";

export function pickGuideFile(distDir: string, env: EnvLike, exists: (p: string) => boolean): string | null {
  const forced = env.HANOMAN_AGENT_DOC?.trim();
  if (forced) {
    // Gagal KERAS: override yang salah lebih baik terbaca sebagai galat daripada jadi 404 misterius.
    if (!exists(forced)) throw new Error(`HANOMAN_AGENT_DOC menunjuk berkas yang tak ada: ${forced}`);
    return forced;
  }
  // `..`    → paket npm (<pkg>/dist).
  // `../..` → checkout, melayani `server/dist` (build) DAN `server/src` (tsx dev) sekaligus.
  for (const c of [resolve(distDir, "..", AGENT_DOC_REL), resolve(distDir, "../..", AGENT_DOC_REL)]) {
    if (exists(c)) return c;
  }
  return null;
}
