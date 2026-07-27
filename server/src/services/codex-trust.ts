import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";

// SPEC-338 · ADR-0074 — TUI codex menolak jalan di direktori yang belum dipercaya:
// "Do you trust the contents of this directory?". Layar itu memblok sesi selamanya di dashboard
// (tak ada manusia yang menekan Enter di pane tmux), dan `-c projects."…".trust_level="trusted"`
// TIDAK membukanya — gerbangnya membaca config yang TERSIMPAN, bukan override runtime. Itu
// disengaja: sebuah gerbang keamanan yang bisa dibuka flag bukan gerbang.
//
// Yang menolongnya: trust pada ROOT REPO menurun ke worktree di bawahnya. Sesi hanoman selalu
// lahir di `<repoDir>/.worktrees/<id>`, jadi cukup SATU entri per project — bukan per sesi, yang
// akan menggelembungkan config codex dengan ratusan direktori ephemeral.
//
// Isinya persis yang codex tulis sendiri ketika manusia menjawab "Yes, continue".

const codexHome = (home?: string): string =>
  home ?? process.env.CODEX_HOME ?? `${homedir()}/.codex`;

export const codexConfigPath = (home?: string): string => `${codexHome(home)}/config.toml`;

/**
 * Pastikan `repoDir` tercatat trusted di config codex. Idempoten, append-only, tak pernah
 * menyentuh kunci lain. Gagal-diam: sesi lebih baik lahir lalu memperlihatkan layar trust-nya
 * daripada request Start-nya 500 karena home codex tak bisa ditulis.
 */
export function ensureCodexTrust(repoDir: string, home?: string): void {
  const path = codexConfigPath(home);
  // SPEC-337 · gerbang trust codex mencocokkan REALPATH direktori, bukan ejaan yang kita simpan.
  // Di macOS `/tmp` & `/var` adalah symlink ke `/private/...` (begitu pula repoDir yang dicapai
  // lewat symlink), jadi entri ber-path mentah tak pernah cocok dan sesi codex mati di layar
  // "Do you trust the contents of this directory?" — tanpa manusia di pane yang bisa menjawab.
  // Path yang belum ada di disk (realpath melempar) ditulis apa adanya: lebih baik satu entri
  // tak terpakai daripada menggagalkan kelahiran sesi.
  let canonical = repoDir;
  try { canonical = realpathSync(repoDir); } catch { /* belum ada di disk — pakai apa adanya */ }
  const header = `[projects."${canonical}"]`;
  try {
    let existing = "";
    try { existing = readFileSync(path, "utf8"); } catch { /* belum ada — dibuat di bawah */ }
    if (existing.includes(header)) return;
    mkdirSync(codexHome(home), { recursive: true });
    const lead = existing === "" || existing.endsWith("\n") ? "" : "\n";
    appendFileSync(path, `${lead}\n${header}\ntrust_level = "trusted"\n`);
  } catch { /* home codex read-only — biarkan codex sendiri yang bertanya */ }
}
