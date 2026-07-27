import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CodexLimitsDTO, LimitWindow, LimitSeverity } from "@hanoman/shared";

// SPEC-338 · ADR-0074 — limit langganan codex.
//
// Berbeda dari limit claude (`services/limits.ts`) yang memanggil endpoint OAuth Anthropic tiap 30
// detik, di sini TIDAK ada panggilan jaringan dan TIDAK ada token codex yang disentuh. Codex sudah
// menuliskan kuotanya sendiri ke rollout sesinya:
//
//   {"type":"event_msg","payload":{"type":"token_count","rate_limits":{
//      "primary":{"used_percent":10.0,"window_minutes":300,"resets_at":1783072313},
//      "secondary":{...}|null,"plan_type":"pro","rate_limit_reached_type":null}}}
//
// Itu angka yang datang dari API-nya sendiri — sumber paling otoritatif yang tersedia, gratis, dan
// tanpa risiko kredensial. Konsekuensinya jujur: nilainya SNAPSHOT, hanya bergerak saat ada sesi
// codex berjalan. `fetchedAt` = waktu snapshot, dan snapshot lawas dilaporkan `stale`.
//
// JEBAKAN yang sudah terbukti: `primary`/`secondary` BUKAN 5-jam/mingguan tetap — pada 27 Jul
// `primary` justru window 10080 menit sementara pada 3 Jul ia 300 menit. Label WAJIB diturunkan
// dari `window_minutes`, tak pernah dari nama kuncinya.

const TTL_MS = 30_000;
// Snapshot lebih tua dari ini dilaporkan `stale`: masih ditampilkan (lebih berguna daripada kosong),
// tapi operator tahu angkanya belum tentu mencerminkan kuota sekarang.
const STALE_AFTER_MS = 12 * 3_600_000;
// Rollout sesi panjang bisa besar; kuota selalu ada di dekat AKHIR berkas. Baca ekornya saja supaya
// biaya terikat, bukan tumbuh bersama panjang sesi.
const TAIL_BYTES = 512 * 1024;
// Cukup untuk menemukan sesi terakhir yang benar-benar melaporkan kuota — sesi yang mati sebelum
// giliran pertama selesai (mis. langsung ditutup operator) tak pernah menulis `rate_limits`.
const MAX_FILES = 8;

let cache: CodexLimitsDTO | null = null;
let freshUntil = 0;

export const codexSessionsDir = (): string =>
  join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");

const UNAVAILABLE: CodexLimitsDTO = { status: "unavailable", windows: [], fetchedAt: null, plan: null };

// Label dari LEBAR window, bukan dari nama kuncinya (lihat jebakan di atas). 300 & 10080 diberi
// nama yang sama dengan padanan claude supaya kedua badge terbaca satu bahasa.
function windowLabel(minutes: number): string {
  if (minutes === 300) return "Sesi 5 jam";
  if (minutes === 10080) return "Mingguan";
  if (minutes % 1440 === 0) return `${minutes / 1440} hari`;
  if (minutes % 60 === 0) return `${minutes / 60} jam`;
  return `${minutes} menit`;
}

const severityOf = (pct: number): LimitSeverity =>
  pct >= 90 ? "critical" : pct >= 70 ? "warning" : "normal";

type RawWindow = { used_percent?: number; window_minutes?: number; resets_at?: number | null };
type RawRateLimits = {
  primary?: RawWindow | null; secondary?: RawWindow | null;
  plan_type?: string | null; rate_limit_reached_type?: string | null;
};

function toWindow(slot: "primary" | "secondary", raw: RawWindow, reached?: string | null): LimitWindow {
  const minutes = raw.window_minutes ?? 0;
  const usedPct = Math.round(raw.used_percent ?? 0);
  return {
    key: `codex:${slot}:${minutes}`,
    label: windowLabel(minutes),
    usedPct,
    // Codex melaporkan epoch DETIK; LimitWindow.resetsAt adalah ISO.
    resetsAt: raw.resets_at ? new Date(raw.resets_at * 1000).toISOString() : null,
    severity: severityOf(usedPct),
    // Codex tak punya `is_active` seperti Anthropic. Yang paling dekat: window yang BENAR-BENAR
    // kena limit. Tak ada yang kena → tak ada yang diklaim aktif (jangan mengarang).
    isActive: reached === slot,
  };
}

/** Kumpulkan berkas rollout terbaru (mtime desc) dari sessions/<Y>/<M>/<D>/*.jsonl. */
async function recentRollouts(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    // `recursive` menghindari tiga lapis readdir manual untuk tata letak Y/M/D milik codex.
    entries = (await readdir(dir, { recursive: true })).filter((f) => f.endsWith(".jsonl"));
  } catch { return []; }
  const stamped = await Promise.all(entries.map(async (rel) => {
    const full = join(dir, rel);
    try { return { full, mtime: (await stat(full)).mtimeMs }; } catch { return null; }
  }));
  return stamped.filter((x): x is { full: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_FILES)
    .map((x) => x.full);
}

/** Baca ekor berkas (≤ TAIL_BYTES) sebagai teks. Baris pertama bisa terpotong — pemanggil memaafkannya. */
async function readTail(file: string): Promise<string> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally { await fh.close(); }
}

type Snapshot = { ts: string; rl: RawRateLimits };

/** `rate_limits` TERAKHIR di dalam satu berkas. Baris rusak/terpotong dilewati diam-diam. */
function lastSnapshot(text: string): Snapshot | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes('"rate_limits"')) continue;
    try {
      const d = JSON.parse(line) as { timestamp?: string; payload?: { rate_limits?: RawRateLimits | null } };
      const rl = d.payload?.rate_limits;
      if (rl && (rl.primary || rl.secondary)) return { ts: d.timestamp ?? new Date().toISOString(), rl };
    } catch { /* baris terpotong di batas ekor, atau rusak — lanjut ke atasnya */ }
  }
  return null;
}

async function readLimits(dir: string): Promise<CodexLimitsDTO> {
  let best: Snapshot | null = null;
  for (const file of await recentRollouts(dir)) {
    let snap: Snapshot | null = null;
    try { snap = lastSnapshot(await readTail(file)); } catch { continue; }
    // Berkas diurut mtime, tapi timestamp isi yang menentukan mana yang benar-benar terbaru.
    if (snap && (!best || snap.ts > best.ts)) best = snap;
  }
  if (!best) return UNAVAILABLE;

  const { rl } = best;
  const reached = rl.rate_limit_reached_type ?? null;
  const windows: LimitWindow[] = [];
  if (rl.primary) windows.push(toWindow("primary", rl.primary, reached));
  if (rl.secondary) windows.push(toWindow("secondary", rl.secondary, reached));

  const age = Date.now() - new Date(best.ts).getTime();
  return {
    status: age > STALE_AFTER_MS ? "stale" : "ok",
    windows,
    fetchedAt: best.ts,
    plan: rl.plan_type ?? null,
  };
}

/** Limit codex saat ini. `dir` hanya untuk test; produksi memakai $CODEX_HOME/sessions. */
export async function getCodexLimits(dir?: string): Promise<CodexLimitsDTO> {
  if (dir) return readLimits(dir);            // jalur test: jangan pernah menyentuh cache proses
  if (cache && Date.now() < freshUntil) return cache;
  const dto = await readLimits(codexSessionsDir());
  if (dto.status !== "unavailable") { cache = dto; freshUntil = Date.now() + TTL_MS; }
  return dto;
}

// Untuk test: bersihkan cache antar kasus.
export function _resetCodexLimitsCache(): void { cache = null; freshUntil = 0; }
