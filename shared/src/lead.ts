import { z } from "zod";

// SPEC-409 · ADR-0091 · hanoman-lead: peran "tech lead mesin" di atas semua agen. Modul ini adalah
// bagian MURNI-nya — kosakata keputusan, permukaan tindakan, dan klasifikasi bobot — supaya server
// (gate tindakan), UI (label), dan test berbicara dari satu sumber.
//
// PRD `docs/prd/orchestrator-hanoman.md` membalik kontrak otonomi ADR-0035: lead memutuskan lalu
// melapor. Pengaman satu-satunya yang tak bisa dilucuti operator hidup di sini: `LEAD_ACTIONS`
// adalah ALLOWLIST, bukan denylist (AC-31/32/34). Tindakan yang tak tercantum tak punya jalan
// masuk — termasuk lewat konfigurasi.

/** Pintu masuk sebuah keputusan (AC-23). */
export const zLeadGate = z.enum(["contract", "detected", "pulse"]);
export type LeadGate = z.infer<typeof zLeadGate>;

/** Jenis keputusan; menentukan bagaimana UI mengelompokkannya & apakah ia berbobot. */
export const zLeadKind = z.enum(["answer", "order", "collision", "quality", "refusal"]);
export type LeadKind = z.infer<typeof zLeadKind>;

/** Tingkat keyakinan. `ragu` WAJIB memicu notifikasi (AC-21). */
export const zLeadConfidence = z.enum(["tinggi", "sedang", "ragu"]);
export type LeadConfidence = z.infer<typeof zLeadConfidence>;

/**
 * Status baris jejak. `gagal` bukan keputusan melainkan catatan bahwa lead TIDAK berhasil
 * memutuskan dalam batas waktu (AC-4) — ia tetap disimpan, karena "tak ada barisnya" tak bisa
 * dibedakan dari "tak pernah diminta".
 */
export const zLeadStatus = z.enum(["berlaku", "ditimpa", "dibatalkan", "gagal"]);
export type LeadStatus = z.infer<typeof zLeadStatus>;

/**
 * PERMUKAAN TINDAKAN LEAD — allowlist tertutup (AC-31/32/34).
 *
 * Sengaja tak memuat: deploy, perintah/konsol VPS, sentuhan data produksi, dan penghapusan apa pun
 * (project, backlog, branch, worktree, notifikasi, baris jejak). Tak ada knob yang bisa
 * menambahkannya — daftar ini konstanta modul, bukan konfigurasi, persis karena AC-31 berbunyi
 * "dalam keadaan apa pun, termasuk saat operator memintanya lewat konfigurasi".
 *
 * `stop-session` ADA di daftar, tapi menghentikan sesi TIDAK menghapus worktree-nya (AC-32a) —
 * itu ditegakkan di sisi server (routes/lead.ts), bukan di sini.
 */
export const LEAD_ACTIONS = [
  "none",              // keputusan murni jawaban; tak ada tindakan menyusul
  "answer-session",    // ketik jawaban ke pane sesi (pintu deteksi otomatis)
  "start-session",     // mulai sesi untuk sebuah backlog (lewat antrean scheduler)
  "stop-session",      // hentikan sesi — worktree DIBIARKAN utuh (AC-32a)
  "resume-session",    // lanjutkan sesi terputus (jalur ADR-0084)
  "restart-session",   // ulangi pekerjaan dari awal
  "order-queue",       // tata urutan antrean yang sudah ada (ADR-0072) — bukan antrean kedua
  "hold-work",         // tunda satu pekerjaan karena tabrakan area kerja
  "push-branch",       // dorong perubahan ke branch
  "integrate-main",    // integrasikan ke branch utama (risiko yang diterima sadar, PRD §Risiko)
  "run-migration",     // jalankan migration pada basis data LOKAL operator
] as const;
export type LeadAction = (typeof LEAD_ACTIONS)[number];
export const zLeadAction = z.enum(LEAD_ACTIONS);

/**
 * Tindakan yang TERKUNCI, ditulis eksplisit meski allowlist sudah menutupnya. Gunanya dua:
 * pesan penolakan yang bisa dibaca manusia (AC-33), dan test yang membuktikan niatnya —
 * allowlist yang kebetulan bertambah satu entri berbahaya akan menabrak test ini.
 */
export const LEAD_FORBIDDEN: Record<string, string> = {
  deploy: "deploy ke produksi",
  "vps-exec": "menjalankan perintah di VPS",
  "vps-console": "membuka konsol VPS",
  "prod-data": "menyentuh data produksi",
  "delete-project": "menghapus project",
  "delete-spec": "menghapus backlog",
  "delete-branch": "menghapus branch",
  "delete-worktree": "menghapus worktree",
  "delete-notification": "menghapus notifikasi",
  "delete-decision": "menghapus jejak keputusan",
};

/** True hanya untuk tindakan yang ada di allowlist. Apa pun selain itu terkunci. */
export function leadActionAllowed(action: string): action is LeadAction {
  return (LEAD_ACTIONS as readonly string[]).includes(action);
}

/** Alasan penolakan yang bisa dibaca manusia; untuk tindakan tak dikenal pun tetap berbunyi. */
export function leadRefusalReason(action: string): string {
  return LEAD_FORBIDDEN[action] ?? `tindakan "${action}" di luar permukaan tindakan lead`;
}

/**
 * "Putusan berbobot" (OQ-5, AC-25). Empat pemicu: tindakan yang sulit dibatalkan
 * (integrate/migration/stop/restart), keraguan, tabrakan area kerja, dan penolakan tindakan
 * terkunci. Fungsi murni supaya definisinya bisa diuji dan tak tersebar di call site.
 */
export function isWeightyDecision(o: { kind: LeadKind; action: LeadAction; confidence: LeadConfidence }): boolean {
  if (o.confidence === "ragu") return true;
  if (o.kind === "collision" || o.kind === "refusal") return true;
  return o.action === "integrate-main" || o.action === "run-migration"
    || o.action === "stop-session" || o.action === "restart-session";
}

/**
 * Bentuk jawaban terstruktur yang WAJIB dikembalikan lead (AC-1). `refs` divalidasi ulang di
 * server terhadap repo — rujukan yang tak ada tak boleh dilaporkan sebagai rujukan (AC-6).
 * Longgar pada bagian yang tak mengubah keamanan (default terisi) supaya keluaran agen yang
 * sedikit meleset tetap terpakai; ketat pada `action`, yang menggerbangi tindakan nyata.
 */
export const zLeadVerdict = z.object({
  decision: z.string().min(1),
  reason: z.string().min(1),
  refs: z.array(z.string()).default([]),
  confidence: zLeadConfidence.default("sedang"),
  // Sengaja `string`, BUKAN `zLeadAction`: tindakan di luar allowlist harus bisa MASUK supaya
  // server menolaknya secara sadar — mencatat penolakan & menotifikasi operator (AC-33). Kalau
  // enum yang menyaring di sini, permintaan "deploy ke produksi" hanya akan tampak sebagai
  // keluaran rusak, dan justru peristiwa paling layak dilaporkan itulah yang hilang dari jejak.
  action: z.string().default("none"),
  /** Teks yang benar-benar diketik ke pane sesi (pintu deteksi otomatis). */
  reply: z.string().default(""),
});
export type LeadVerdict = z.infer<typeof zLeadVerdict>;

/** Permintaan putusan lewat kontrak eksplisit (pintu #1, AC-1/AC-5). */
export const zLeadAsk = z.object({
  projectId: z.string().min(1),
  specId: z.string().nullish(),
  sessionId: z.string().nullish(),
  question: z.string().min(1).max(8000),
  options: z.array(z.string().max(2000)).max(20).default([]),
  context: z.string().max(20_000).default(""),
});
export type LeadAsk = z.infer<typeof zLeadAsk>;

/** Jawaban operator yang menimpa keputusan lead (AC-28). */
export const zLeadOverride = z.object({
  answer: z.string().min(1).max(8000),
  reason: z.string().max(8000).default(""),
});
