import { readFileSync, readdirSync } from "node:fs";
import { PIPELINES, type Flow } from "@hanoman/runner";
import type { Stage } from "@hanoman/shared";
import { STAGES } from "./stage-machine";

export type PhaseState = "done" | "skipped" | "active" | "pending";
export type Phase = { name: string; state: PhaseState };

// Di luar worktree: `git add -A` milik agen tak boleh bisa melihatnya. `.worktrees` sudah
// ada di .gitignore, jadi berkas ini tak pernah mendarat di branch mana pun.
export const phaseFilePath = (repoDir: string, sessionId: string): string =>
  `${repoDir}/.worktrees/.phases/${sessionId}`;

// SPEC-184 · marker "menunggu keputusan manusia" per sesi. Sekamar dengan berkas fase, di dalam
// `.worktrees` yang sudah `.gitignore` — tak pernah mendarat di branch mana pun. Kosong = tak
// menunggu; non-kosong (ditulis hook Notification) = butuh keputusan.
export const decisionFilePath = (repoDir: string, sessionId: string): string =>
  `${repoDir}/.worktrees/.decisions/${sessionId}`;

// Satu baris = satu transisi: "<Nama Fase> done" | "<Nama Fase> skipped". Nama fase boleh
// berspasi ("Doc index"), jadi state-nya token TERAKHIR. Baris yang tak dikenali diabaikan —
// berkas ini ditulis agen lewat `echo`, dan tak boleh ada yang bisa menyandera tampilan fase.
function recorded(file: string): Map<string, PhaseState> {
  const out = new Map<string, PhaseState>();
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch { return out; }
  for (const line of raw.split("\n")) {
    const trimmed = line.trimEnd();
    const i = trimmed.lastIndexOf(" ");
    if (i < 1) continue;
    const state = trimmed.slice(i + 1);
    if (state !== "done" && state !== "skipped") continue;
    out.set(trimmed.slice(0, i).trim(), state);
  }
  return out;
}

// Fase aktif diturunkan, tidak disimpan: yang pertama belum tercatat.
export function readPhases(file: string, flow: Flow): Phase[] {
  const seen = recorded(file);
  let activeTaken = false;
  return PIPELINES[flow].map((name) => {
    const state = seen.get(name);
    if (state) return { name, state };
    if (activeTaken) return { name, state: "pending" as const };
    activeTaken = true;
    return { name, state: "active" as const };
  });
}

// ADR-0008 · Spec.stage cermin fase, hanya maju. `skipped` dihitung sebagai tercapai:
// jalur cepat qa melewati Spec+Plan justru karena pekerjaannya tak diperlukan.
const REACHED: Record<string, Stage> = {
  Objective: "objective", Audit: "objective", Spec: "spec-ready", Plan: "planned", Execute: "done",
};
export function stageFor(phases: Phase[]): Stage | null {
  let best = -1;
  for (const p of phases) {
    if (p.name === "Execute" && p.state === "active") best = Math.max(best, STAGES.indexOf("executing"));
    if (p.state !== "done" && p.state !== "skipped") continue;
    const s = REACHED[p.name];
    if (s) best = Math.max(best, STAGES.indexOf(s));
  }
  if (phases[0]?.state === "active") best = Math.max(best, STAGES.indexOf("brainstorming"));
  return best < 0 ? null : STAGES[best]!;
}

// SPEC-173 · ADR-0029 — plan superpowers milik spec ini, dibaca dari worktree run-nya:
// `false` hanya jika ada file plan yang cocok segmen spec-id DAN masih memuat task `- [ ]`.
// Tak ada plan yang cocok (fast-path qa yang melewati Plan, atau worktree tanpa docs) →
// `true`: tak ada checklist untuk digerbang. Cocokkan sama seperti artifactsToRemove —
// batas kiri non-alnum, kanan non-digit, jadi "spec-16" tak menyerempet "spec-167".
export function planComplete(worktree: string, specId: string): boolean {
  const dir = `${worktree}/docs/superpowers/plans`;
  const re = new RegExp(`(^|[^a-z0-9])${specId.toLowerCase()}([^0-9]|$)`);
  let names: string[];
  try { names = readdirSync(dir); } catch { return true; }
  for (const n of names) {
    if (!re.test(n.toLowerCase())) continue;
    try { if (/^[ \t]*- \[ \]/m.test(readFileSync(`${dir}/${n}`, "utf8"))) return false; }
    catch { /* file lenyap saat dibaca — abaikan */ }
  }
  return true;
}

// Stage turunan untuk run nyata: `Execute done` hanya sah bila plan spec-nya terceklist
// penuh. Selama masih ada `- [ ]`, agen berhenti sebelum semua PR selesai — tahan di
// `executing`, jangan biarkan backlog claim `done`. `stageFor` yang murni tetap dipakai
// langsung oleh test; gerbang I/O hidup di sini, dipanggil kedua jalur persist stage.
export function stageForRun(phases: Phase[], worktree: string, specId: string): Stage | null {
  const s = stageFor(phases);
  if (s === "done" && !planComplete(worktree, specId)) return "executing";
  return s;
}
