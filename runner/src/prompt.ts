import type { Flow, SpecBrief, ProjectBrief } from "./types";
import { REVERSE_STANDARD } from "./reverse-standard";

export const PIPELINES: Record<Flow, readonly string[]> = {
  feature: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"],
  qa: ["Audit", "Spec", "Plan", "Execute"],
  scaffold: ["Brainstorm", "Objective", "Doc index"],
  reverse: ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"],
};

// SPEC-187 · ADR-0035 — sesi spec-flow menggerakkan dirinya sendiri melewati seluruh fase
// (ADR-0024): tak ada runner yang menyuntik giliran berikutnya. Skill superpowers punya
// checkpoint "review/approval"; di sesi tak-berpenunggu itu BUKAN titik berhenti, dan agen
// yang mematuhinya akan mandek diam menunggu review yang tak akan datang. Berhenti hanya untuk
// keputusan manusia sejati, yang agen surface sebagai pertanyaan di terminalnya (ADR-0024).
// Sengaja tak dipakai startProjectPrompt: fase Wawancara reverse memang interaktif.
const AUTONOMY_CLAUSE =
  "Jalankan seluruh pipeline sampai tuntas tanpa berhenti di batas antar-fase. Checkpoint "
  + "\"review\"/\"approval\"/\"need review\" milik skill superpowers BUKAN titik berhenti di sini — "
  + "lanjut saja ke fase berikutnya. Berhenti HANYA saat butuh keputusan manusia sejati (percabangan "
  + "yang mengubah bentuk kerja: data model, kontrak API, scope); saat itu tanyakan di terminal ini "
  + "dan tunggu jawabannya. Selain itu, terus lanjut.";

// Agen yang melapor, server yang menonton: di PTY tak ada batas giliran yang terbaca mesin.
// Append, bukan tulis-timpa — keadaan penuh selalu ada di berkasnya, jadi tak ada transisi
// yang bisa terlewat kalau server sedang tidak menonton. Berkasnya di luar worktree, jadi
// `git add -A` milik agen tak mungkin men-stage-nya.
const phaseInstruction = (phases: readonly string[]) => {
  const base =
    `Kerjakan fase berurutan: ${phases.join(" → ")}.\n`
    + `Setiap kali sebuah fase selesai (atau kamu putuskan dilewati), append satu baris ke berkas `
    + `di $HANOMAN_PHASE_FILE — persis: \`echo "<Nama Fase> done" >> "$HANOMAN_PHASE_FILE"\`, `
    + `atau \`skipped\` sebagai ganti \`done\`. Nama fase ditulis apa adanya seperti di atas.`;
  // Flow ber-fase Plan+Execute saja (feature, qa): Execute belum selesai selama plan masih
  // punya kotak `- [ ]`. Cermin server-side gate (SPEC-173, ADR-0029) di prompt-nya.
  if (!phases.includes("Plan") || !phases.includes("Execute")) return base;
  return base
    + `\nExecute BELUM selesai selama plan (\`docs/superpowers/plans/**\`) masih punya task `
    + `\`- [ ]\`: kerjakan SEMUA PR/task sampai tiap kotak jadi \`- [x]\` sebelum menulis `
    + `\`Execute done\`. hanoman menahan backlog di \`executing\`, bukan \`done\`, selama masih ada \`- [ ]\`.`;
};

// Peta fase → skill superpowers (SPEC-166). Objective dan Spec adalah keluaran skill
// brainstorming yang di-invoke di fase Brainstorm — sengaja tak punya entri sendiri.
// Fase reverse dipandu standar docs di prompt-nya, bukan skill.
const PHASE_SKILLS: Record<string, readonly string[]> = {
  Brainstorm: ["superpowers:brainstorming"],
  Audit: ["superpowers:systematic-debugging"],
  Plan: ["superpowers:writing-plans"],
  Execute: [
    "superpowers:executing-plans",
    "superpowers:test-driven-development",
    "superpowers:verification-before-completion",
  ],
};

const skillInstruction = (phases: readonly string[]) => {
  const lines = phases
    .filter((p) => PHASE_SKILLS[p])
    .map((p) => `- ${p}: ${PHASE_SKILLS[p]!.join(", ")}`);
  return lines.length
    ? "Skills superpowers WAJIB: sebelum mengerjakan fase di bawah, invoke skill-nya lewat "
      + `Skill tool — bila skill relevan tersedia, pakai.\n${lines.join("\n")}`
    : "";
};

export function startPrompt(flow: Flow, spec: SpecBrief, branchTo: string): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow}. Ikuti internal/docs sebagai Source of Truth; perbarui docs yang tersentuh `
      + `dan link-nya di index, dalam commit yang sama.`,
    phaseInstruction(PIPELINES[flow]),
    AUTONOMY_CLAUSE,
    skillInstruction(PIPELINES[flow]),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}

// SPEC-172 · reopen sesi backlog item yang keburu ditandai `done` padahal kerjanya belum
// tuntas (mis. spec ber-banyak-PR, baru sebagian beres). Beda dari startPrompt: TIDAK
// menggiring pipeline dari awal — spec & plan sudah ada, jadi sesi lanjut langsung di
// Execute. Kontinuitas: plan di docs/superpowers/plans/** menandai task `[x]`/`[ ]`, dan
// kerja yang selesai umumnya sudah ter-merge ke branchFrom (worktree lahir dari sana).
export function continuePrompt(flow: Flow, spec: SpecBrief, branchTo: string): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow} — MELANJUTKAN backlog item yang sebelumnya ditandai selesai padahal `
      + `pekerjaannya belum tuntas. Ikuti internal/docs sebagai Source of Truth; perbarui `
      + `docs yang tersentuh dan link-nya di index, dalam commit yang sama.`,
    `JANGAN mengulang fase awal — spec & plan sudah ada. Lanjut di fase Execute: baca plan `
      + `di docs/superpowers/plans/** untuk backlog item ini, periksa task yang sudah \`[x]\` `
      + `dan selesaikan yang masih \`[ ]\`. Verifikasi nyata sebelum klaim selesai.`,
    AUTONOMY_CLAUSE,
    skillInstruction(["Execute"]),
    `Setelah selesai: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Worktree `
      + `ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}

// Panduan per fase reverse (SPEC-166). Wawancara adalah fase interaktif: manusia menonton
// sesi ini lewat terminal dashboard dan menjawab di sana — karena itu SATU pertanyaan per
// giliran, bukan borongan.
const REVERSE_PHASE_GUIDE = [
  "- Scan: baca source code — stack, arsitektur, data model, API surface, perilaku domain. Belum menulis docs.",
  "- Docs teknis: tulis kategori yang bisa diturunkan dari kode (architecture, requirements + "
    + "EARS dari perilaku nyata, adr ber-Status accepted (reverse-engineered), operations, "
    + "security, design-system/frontend bila relevan). Isi lengkap dan spesifik, bukan kerangka.",
  "- Wawancara: untuk product, business, brand, research, entrypoints — ajukan SATU pertanyaan "
    + "per giliran ke manusia di terminal ini, tunggu jawabannya, isi docs dari jawaban. "
    + "Jangan mengarang. Topik tanpa jawaban tandai: Status: draft — menunggu input.",
  "- Konvensi & index: tulis internal/docs/README.md (index bernomor lengkap), CLAUDE.md, "
    + "AGENTS.md, .claude/settings.json + .claude/hooks/ensure-docs-updated.py persis seperti STANDAR DOCS.",
  "- Serah terima: pastikan setiap berkas docs terdaftar di index, lalu tulis ringkasan hasil "
    + "+ daftar pertanyaan yang belum terjawab ke terminal.",
].join("\n");

export function startProjectPrompt(flow: Flow, project: ProjectBrief, branchTo: string): string {
  return [
    `hanoman ${flow}. Susun Source of Truth repo ini dari kodenya di internal/docs/**, `
      + `mengikuti STANDAR DOCS di bagian bawah prompt ini.`,
    phaseInstruction(PIPELINES[flow]),
    REVERSE_PHASE_GUIDE,
    `Setiap fase selesai: commit hasilnya, lalu \`git push origin HEAD:refs/heads/${branchTo}\` — `
      + `push per fase, supaya pekerjaan tak hilang bila worktree lenyap. Bila remote origin tidak ada, `
      + `lewati push dan catat itu di laporan akhir — jangan gagal diam-diam. Worktree ini `
      + `detached HEAD — memang disengaja. Manusia yang me-review dan merge branch ${branchTo}.`,
    `Project ${project.id} · ${project.name}\nDeskripsi: ${project.desc || "—"}\nStack: ${project.stack || "—"}`,
    `=== STANDAR DOCS ===\n${REVERSE_STANDARD}`,
  ].join("\n\n");
}
