import { readFileSync, rmSync } from "node:fs";
import type { Ask, AskOption, Flow, RunInput, StepModels } from "./types";

// Artefak keputusan pasca-Audit (SPEC-145). Ditulis agen di root worktree, dibaca `runOne`,
// dan dihapus TANPA SYARAT sebelum commit — `git add -A` men-stage berkas ber-titik di root,
// jadi artefak yang tertinggal akan mendarat di `branchTo` milik repo project.
export const DECISION_FILE = ".hanoman-decision.json";

// Fase perencanaan alur qa. Dinamai, bukan `PIPELINES.qa.slice(1, -1)`: yang dilewati adalah
// "merencanakan", bukan "apa pun yang kebetulan berada di antara Audit dan Execute".
export const QA_PLANNING = ["Spec", "Plan"] as const;

export type Decision = { path: "execute" | "spec"; reason?: string };

// HANYA `path === "execute"` yang memilih jalur cepat. Berkas hilang, JSON rusak, bukan objek,
// `path` tak dikenal (termasuk "none" di masa depan) → jalur penuh. Fail-safe secara konstruksi.
// Tidak pernah melempar: yang gagal di sini sebuah optimasi, bukan guardrail (bandingkan ADR-0009).
export function readDecision(worktree: string): Decision {
  try {
    const j = JSON.parse(readFileSync(`${worktree}/${DECISION_FILE}`, "utf8")) as Record<string, unknown>;
    if (j?.path !== "execute") return { path: "spec" };
    return typeof j.reason === "string" ? { path: "execute", reason: j.reason } : { path: "execute" };
  } catch { return { path: "spec" }; }
}

// Pertanyaan agen ke manusia (SPEC-157). Ditulis agen di root worktree, dibaca `runOne` di
// antara giliran, dan — seperti DECISION_FILE — dihapus TANPA SYARAT sebelum commit.
export const ASK_FILE = ".hanoman-ask.json";

// Fail-safe by construction, persis seperti `readDecision`: berkas absen, JSON rusak, bukan
// objek, opsi < 2, atau `default` di luar menu → `null`, dan run berjalan seperti tanpa fitur
// ini. Berkas yang cacat tidak boleh bisa menyandera run. Tidak pernah melempar.
//
// Berkasnya DIKONSUMSI (unlink) sebelum diparse, bukan sesudah: satu tulis = satu pertanyaan,
// dan ask rusak yang tertinggal akan dibaca ulang di setiap fase berikutnya selamanya.
export function readAsk(worktree: string): Ask | null {
  const path = `${worktree}/${ASK_FILE}`;
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return null; }
  rmSync(path, { force: true });
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j?.question !== "string" || !j.question.trim()) return null;
    if (!Array.isArray(j.options) || j.options.length < 2) return null;
    const options: AskOption[] = [];
    for (const o of j.options as Record<string, unknown>[]) {
      if (typeof o?.value !== "string" || !o.value) return null;
      if (typeof o?.label !== "string" || !o.label) return null;
      options.push({ value: o.value, label: o.label, ...(typeof o.detail === "string" ? { detail: o.detail } : {}) });
    }
    if (typeof j.default !== "string" || !options.some((o) => o.value === j.default)) return null;
    return { question: j.question, options, default: j.default };
  } catch { return null; }
}

const STEP: Record<string, keyof StepModels> = {
  Brainstorm: "brainstorm", Objective: "brainstorm", Spec: "spec", Plan: "plan",
  Execute: "execute", Audit: "audit", "Doc index": "spec", Scan: "audit",
};
export const stepFor = (phase: string): keyof StepModels => STEP[phase] ?? "execute";
// The spec block is what ties a run to the backlog item that spawned it: the id
// alone is not resolvable from inside the worktree (specs live in Postgres, not
// in the repo), so it has to be spelled out in the prompt.
function specBlock(input: RunInput): string {
  const s = input.spec;
  if (!s) return input.specId ? `\n\nBacklog item: ${input.specId} (detail tidak termuat).` : "";
  const detail = s.payload ? `\nDetail: ${JSON.stringify(s.payload)}` : "";
  return `\n\nBacklog item ${s.id} · sumber ${s.source} · prioritas ${s.priority}\nJudul: ${s.title}\nObjective: ${s.objective}${detail}`;
}
// Fase Audit alur qa memilih jalur hilirnya sendiri. Instruksinya dipancarkan tanpa syarat —
// `hanoman qa --only Audit` menuliskan artefaknya, tak punya fase hilir untuk dipangkas, dan
// unlink pra-commit tetap membersihkannya. Satu cabang lebih sedikit.
const DECIDE = `\n\nSebelum menutup fase ini, tulis keputusan jalur ke \`${DECISION_FILE}\` di root worktree: `
  + `{"path":"execute"|"spec","reason":"<satu kalimat>"}. `
  + `Pilih "execute" HANYA bila seluruhnya benar: perbaikannya terlokalisasi (satu–dua berkas), `
  + `tidak menuntut keputusan desain, tidak menyentuh skema database maupun kontrak API, dan kamu `
  + `yakin dapat menyelesaikannya tanpa spec dan plan. Saat ragu, pilih "spec".`;

// Dipancarkan di SETIAP fase dan setiap flow: percabangan desain bisa muncul di mana saja,
// termasuk di tengah Execute. `default` wajib — ia yang dipakai kalau tak ada manusia menjawab.
const ASK = `\n\nKalau sebuah keputusan menentukan bentuk data model, kontrak API, atau ruang lingkup, `
  + `dan kamu tidak yakin: JANGAN menebak. Tulis \`${ASK_FILE}\` di root worktree lalu akhiri giliranmu. `
  + `Bentuknya: {"question":"<satu pertanyaan>","options":[{"value":"<slug>","label":"<singkat>","detail":"<satu kalimat>"}, …],`
  + `"default":"<value yang kamu condongi>"}. Minimal dua opsi; \`default\` wajib salah satu \`value\`. `
  + `Run akan berhenti dan menunggu manusia menjawab; kalau tak ada yang menjawab, \`default\` yang dipakai.`;

export function phasePrompt(flow: Flow, phase: string, input: RunInput): string {
  const scope = input.specId
    ? `Kerjakan hanya langkah fase ${phase} untuk backlog item di bawah — jangan kerjakan pekerjaan lain.`
    : `Kerjakan hanya langkah fase ${phase}.`;
  const decide = flow === "qa" && phase === "Audit" ? DECIDE : "";
  return `hanoman ${flow} — fase ${phase}. Ikuti internal/docs sebagai Source of Truth. ${scope} Perbarui docs yang tersentuh dan link di index.${specBlock(input)}${decide}${ASK}`;
}
