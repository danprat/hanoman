import { LEAD_ACTIONS, type LeadKind } from "@hanoman/shared";

// SPEC-409 · ADR-0091 · prompt hanoman-lead. Murni (string masuk, string keluar) supaya bentuk
// kontraknya bisa dites tanpa men-spawn agen apa pun — pola `runner/src/prompt.ts`.

export type LeadContext = {
  projectId: string;
  projectName: string;
  repoDir: string | null;
  /** Backlog item peminta, bila ada. */
  spec?: { id: string; title: string; objective: string; stage: string; priority: string } | null;
  /** Sesi yang sedang berjalan di project ini — konteks yang tak dimiliki sesi manapun (E). */
  liveSessions?: { id: string; specId?: string; flow?: string; branch?: string }[];
  /** Keputusan sebelumnya (terbaru dulu) supaya putusan berikutnya konsisten (US-8). */
  priorDecisions?: { question: string; answer: string; reason: string; createdAt: string }[];
  /** Catatan tambahan yang sudah dikumpulkan pemanggil (mis. daftar berkas yang bertabrakan). */
  notes?: string[];
};

export type LeadQuestion = {
  kind: LeadKind;
  question: string;
  options?: string[];
};

const bullet = (s: string) => `- ${s}`;

/**
 * AC-20/21/22 · tiga hal yang WAJIB ada di prompt ini, dan alasannya:
 *
 * 1. Perintah mengumpulkan bukti DULU (docs SoT, ADR, plan, kode, riwayat git) — lead yang menebak
 *    lebih buruk daripada operator yang absen.
 * 2. Larangan mengembalikan "tidak tahu": setelah bukti dikumpulkan ia tetap harus memutuskan,
 *    memilih opsi yang paling mudah dibatalkan, dan menandai dirinya `ragu`. Itulah seluruh
 *    gunanya lead — keraguan tak boleh berubah jadi mandek yang justru ingin dihapus PRD ini.
 * 3. Permukaan tindakan TERTUTUP. Daftar `action` di bawah adalah satu-satunya yang server terima;
 *    apa pun di luarnya ditolak, dicatat, dan dinotifikasi (AC-33). Menyebutkannya di prompt bukan
 *    pengaman (pengamannya di server) melainkan supaya lead tak menghabiskan giliran mengusulkan
 *    sesuatu yang pasti ditolak.
 */
export function leadPrompt(q: LeadQuestion, c: LeadContext): string {
  const lines: string[] = [];
  lines.push("Kamu adalah **hanoman-lead**: tech lead mesin di atas semua agen yang bekerja di workspace ini.");
  lines.push("Kamu MEMUTUSKAN, lalu melapor. Tidak ada manusia yang menunggu untuk menyetujui jawabanmu.");
  lines.push("");
  lines.push("## Konteks");
  lines.push(bullet(`Project: ${c.projectName} (${c.projectId})`));
  if (c.repoDir) lines.push(bullet(`Checkout: ${c.repoDir}`));
  if (c.spec) {
    lines.push(bullet(`Backlog item: ${c.spec.id} — ${c.spec.title} · stage ${c.spec.stage} · prioritas ${c.spec.priority}`));
    if (c.spec.objective) lines.push(bullet(`Objective: ${c.spec.objective}`));
  }
  for (const s of c.liveSessions ?? []) {
    lines.push(bullet(`Sesi berjalan: ${s.id}${s.specId ? ` (${s.specId})` : ""}${s.flow ? ` · flow ${s.flow}` : ""}${s.branch ? ` · branch ${s.branch}` : ""}`));
  }
  for (const n of c.notes ?? []) lines.push(bullet(n));
  lines.push("");
  if (c.priorDecisions?.length) {
    lines.push("## Keputusan yang sudah kamu ambil sebelumnya (jangan bertentangan tanpa alasan)");
    for (const d of c.priorDecisions.slice(0, 10)) {
      lines.push(`- [${d.createdAt}] "${d.question.slice(0, 200)}" → ${d.answer.slice(0, 300)} (${d.reason.slice(0, 200)})`);
    }
    lines.push("");
  }
  lines.push("## Yang harus kamu putuskan");
  lines.push(q.question.trim());
  if (q.options?.length) {
    lines.push("");
    lines.push("Opsi yang dilihat peminta:");
    for (const [i, o] of q.options.entries()) lines.push(`${i + 1}. ${o}`);
  }
  lines.push("");
  lines.push("## Cara kerja");
  lines.push("1. KUMPULKAN BUKTI DULU sebelum memutuskan: `internal/docs/**` (Source of Truth) dan index-nya, ADR yang relevan, plan `docs/superpowers/plans/**`, kode yang bersangkutan, dan riwayat git. Baca, jangan mengingat.");
  lines.push("2. Putuskan. Kalau setelah membaca kamu masih ragu, TETAP putuskan: pilih opsi yang PALING MUDAH DIBATALKAN, lalu tandai `confidence: \"ragu\"`. Jangan pernah menjawab \"tidak tahu\" atau meminta manusia memutuskan — itu persis keadaan yang kamu ada untuk menghapusnya.");
  lines.push("3. Rujuk bukti yang BENAR-BENAR kamu baca. Rujukan berupa path berkas relatif terhadap checkout, nomor ADR (`ADR-0091`), atau sha commit. Rujukan yang tak ada di repo akan dibuang server dan membuat jawabanmu tampak tanpa dasar.");
  lines.push("4. JANGAN membaca atau mengutip kredensial (isi `.env*`, token, kunci privat). Jejak keputusan disimpan di basis data; rahasia tak boleh mendarat di sana.");
  lines.push("5. Kamu TIDAK mengeksekusi apa pun sendiri. Kamu mengusulkan satu `action`; server yang menjalankannya, dan hanya bila ia ada di daftar tertutup ini:");
  lines.push(`   ${LEAD_ACTIONS.join(" · ")}`);
  lines.push("   Deploy, perintah/konsol VPS, data produksi, dan penghapusan apa pun (project, backlog, branch, worktree, notifikasi, jejak) TERKUNCI dan tidak akan pernah dijalankan.");
  lines.push("");
  lines.push("## Bentuk jawaban (WAJIB)");
  lines.push("Akhiri jawabanmu dengan TEPAT SATU blok berikut, tanpa teks sesudahnya:");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify({
    decision: "keputusan yang dipilih, satu kalimat",
    reason: "alasannya, menyebut bukti",
    refs: ["internal/docs/…", "ADR-00xx"],
    confidence: "tinggi | sedang | ragu",
    action: "none",
    reply: "teks yang akan diketikkan ke terminal agen peminta (kosongkan bila tak relevan)",
  }, null, 2));
  lines.push("```");
  return lines.join("\n");
}
