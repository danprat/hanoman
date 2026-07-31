import { existsSync } from "node:fs";
import { isAbsolute, resolve as resolvePath, relative } from "node:path";
import { zLeadVerdict, type LeadVerdict } from "@hanoman/shared";

// SPEC-409 · ADR-0091 · membaca keluaran agen lead. Pola yang sama dipakai manifest breakdown
// (ADR-0069) dan blok eskalasi audit (ADR-0076): satu blok ```json kanonik, di-parse DEFENSIF —
// keluaran rusak/absen menghasilkan `null`, tak pernah melempar. Bedanya di sini `null` BUKAN
// akhir cerita: pemanggil mencatat kegagalan itu di jejak (AC-4), karena diam saja tak bisa
// dibedakan dari "tak pernah diminta".

/**
 * Ambil blok ```json TERAKHIR. Terakhir, bukan pertama: agen kerap menuliskan contoh bentuk lebih
 * dulu lalu keputusan sebenarnya di akhir — dan yang benar selalu yang paling belakang.
 */
export function extractJsonBlock(raw: string): string | null {
  const re = /```json\s*\n([\s\S]*?)```/g;
  let last: string | null = null;
  for (const m of raw.matchAll(re)) if (m[1]) last = m[1];
  if (last) return last;
  // Fallback: seluruh keluaran memang satu objek JSON telanjang (mode `-p` sering begitu).
  const t = raw.trim();
  return t.startsWith("{") && t.endsWith("}") ? t : null;
}

/** Parse + validasi bentuk. Bentuk yang tak lolos zLeadVerdict → null (tak ada keputusan setengah). */
export function parseLeadVerdict(raw: string): LeadVerdict | null {
  const block = extractJsonBlock(raw);
  if (!block) return null;
  let data: unknown;
  try { data = JSON.parse(block); } catch { return null; }
  const parsed = zLeadVerdict.safeParse(data);
  return parsed.success ? parsed.data : null;
}

// AC-6 · rujukan yang tidak ada di repo TIDAK boleh dilaporkan sebagai rujukan. Dua bentuk rujukan
// yang sah: path berkas relatif terhadap repo, dan sha commit (dibiarkan lewat — keberadaannya
// diverifikasi git, bukan fs). Selain itu dibuang diam-diam: sebuah jawaban dengan nol rujukan
// masih berguna, sebuah jawaban dengan rujukan karangan justru menyesatkan.
const SHA = /^[0-9a-f]{7,40}$/i;

/** Rujukan tak-berkas yang tetap sah (sha commit, ADR yang disebut lewat nomor). */
export const isNonFileRef = (ref: string): boolean => SHA.test(ref) || /^ADR-\d{4}$/i.test(ref);

/**
 * Saring rujukan terhadap repo. `repoDir` kosong (project tanpa binding) → hanya rujukan
 * non-berkas yang lolos: tanpa checkout, tak ada satu pun path yang bisa dibuktikan ada.
 *
 * Path absolut & `..` ditolak: rujukan adalah alamat DI DALAM repo, dan membiarkan `../../etc`
 * lolos berarti jejak keputusan bisa menunjuk berkas mana pun di mesin operator.
 */
export function keepExistingRefs(refs: string[], repoDir: string | null): string[] {
  const out: string[] = [];
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref) continue;
    if (isNonFileRef(ref)) { out.push(ref); continue; }
    if (!repoDir) continue;
    if (isAbsolute(ref)) continue;
    const full = resolvePath(repoDir, ref);
    const rel = relative(repoDir, full);
    if (rel.startsWith("..")) continue;
    if (existsSync(full)) out.push(ref);
  }
  // Dedup sambil menjaga urutan: agen kerap menyebut berkas yang sama dua kali.
  return [...new Set(out)];
}
