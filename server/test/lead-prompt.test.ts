import { describe, it, expect } from "vitest";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { leadPrompt, type LeadContext, type LeadQuestion } from "../src/services/lead/prompt";

// SPEC-432 · audit `research/audit-spec-432-lead-tak-memutuskan-denyut-spam.md`.
//
// Prompt lead memerintahkan "KUMPULKAN BUKTI DULU: internal/docs/**, ADR, plan, kode, riwayat git"
// tanpa pernah menyebut bahwa ada batas waktu — lalu `brain.think()` meng-SIGTERM agennya di detik
// ke-`timeoutSec`. Akibatnya, di DB operator, TUJUH dari tujuh baris jejak berstatus `gagal` dengan
// alasan identik `kehabisan waktu 120000 ms`; nol keputusan `berlaku` pernah lahir.
//
// Terukur pada agen (claude-opus-5 · effort xhigh) dan harness `execFile` yang sama, dua varian
// prompt yang HANYA berbeda pada ada-tidaknya paragraf anggaran waktu:
//   tanpa anggaran → 306 236 ms (2,55× batas 120 dtk, selalu di-SIGTERM di produksi)
//   dengan anggaran → 101 136 ms, blok ```json sah, MASIH DI BAWAH batas 120 dtk yang berlaku
// Anggaran itu karena itu bukan hiasan prompt: ia adalah perbaikannya.

const ctx = (over: Partial<LeadContext> = {}): LeadContext => ({
  projectId: "demo", projectName: "Demo", repoDir: null, timeoutSec: 300, ...over,
});
const q: LeadQuestion = { kind: "answer", question: "Pakai kolom baru atau turunkan?" };

describe("leadPrompt · anggaran waktu (audit SPEC-432)", () => {
  it("tells lead how many seconds it has before it is killed", () => {
    expect(leadPrompt(q, ctx({ timeoutSec: 300 }))).toContain("300 detik");
  });

  // Anggaran yang berbohong lebih buruk daripada tak ada anggaran: agen yang diberi tahu 600 detik
  // lalu dibunuh di detik ke-120 akan menganggarkan pembacaannya ke arah yang salah.
  it("carries the budget that actually applies, not a constant", () => {
    expect(leadPrompt(q, ctx({ timeoutSec: 45 }))).toContain("45 detik");
    expect(leadPrompt(q, ctx({ timeoutSec: 45 }))).not.toContain("300 detik");
  });

  it("orders lead to stop gathering evidence and decide before the budget runs out", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toMatch(/berhenti membaca/i);
  });

  // Perintah "kumpulkan bukti dulu" tetap ada — yang ditambahkan adalah batasnya, bukan penggantinya.
  it("keeps the evidence-first mandate", () => {
    expect(leadPrompt(q, ctx())).toContain("KUMPULKAN BUKTI DULU");
  });
});

describe("LEAD_DEFAULTS.timeoutSec (audit SPEC-432)", () => {
  // 120 dtk bukan angka yang terlalu kecil sedikit — ia lebih kecil daripada ongkos terukur SATU
  // keputusan nyata (306 dtk), jadi tiap keputusan pasti gagal, bukan kadang-kadang.
  it("is larger than the measured cost of one real decision (306 s)", () => {
    expect(LEAD_DEFAULTS.timeoutSec).toBeGreaterThan(306);
  });
});
