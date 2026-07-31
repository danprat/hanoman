import { execFile } from "node:child_process";
import type { Agent } from "@hanoman/shared";
import { effectiveStr } from "../../config";

// SPEC-409 · ADR-0091 · lead adalah AGEN, bukan aturan if/else: pertanyaan yang ia jawab berbentuk
// prosa dan jawabannya menuntut membaca docs/kode/riwayat. Ia dipanggil SEKALI-JALAN dan
// NON-INTERAKTIF (`claude -p` / `codex exec`), lalu keluar.
//
// Ini BUKAN menghidupkan kembali run headless yang dicabut ADR-0024. Yang dicabut itu adalah
// MENGERJAKAN pekerjaan lewat CLI headless bertahap (spec/plan/execute) — pekerjaan tetap milik
// sesi interaktif di tmux. Lead adalah panggilan penasihat berumur pendek yang keluarannya satu
// blok JSON; ia tak menyentuh worktree sesi mana pun dan tak punya fase.
//
// Konsekuensi yang diterima sadar (PRD OQ-1): pemakaian kuotanya menumpang langganan yang sama
// dengan sesi pekerja, dan itu terlihat di badge limit yang sudah ada — bukan akunting terpisah.

/** Cermin `claudeBin()`/`codexBin()` di pty.ts — knob yang sama, supaya test bisa menukar biner. */
const binFor = (agent: Agent): string =>
  agent === "codex"
    ? effectiveStr("HANOMAN_CODEX_BIN") ?? "codex"
    : effectiveStr("HANOMAN_CLAUDE_BIN") ?? "claude";

/**
 * Argv one-shot per agen. TANPA `--settings`/hook: lead tak punya marker keputusan (ia tak boleh
 * bertanya balik — AC-22) dan tak punya berkas fase.
 *
 * `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` tetap dipasang
 * dengan alasan yang sama seperti sesi pekerja (ADR-0037): tanpa itu panggilan non-interaktif
 * menggantung di prompt izin yang tak ada manusianya. Batas kerasnya bukan di sini melainkan di
 * permukaan tindakan lead (shared/src/lead.ts + routes/lead.ts) — lead tak pernah men-shell-out
 * hasil pikirannya sendiri.
 */
export function leadArgv(o: { agent: Agent; model: string; effort: string; prompt: string }): string[] {
  if (o.agent === "codex") {
    return [
      "exec",
      ...(o.model ? ["-m", o.model] : []),
      ...(o.effort ? ["-c", `model_reasoning_effort="${o.effort}"`] : []),
      "--dangerously-bypass-approvals-and-sandbox",
      o.prompt,
    ];
  }
  return [
    "-p",
    ...(o.model ? ["--model", o.model] : []),
    ...(o.effort ? ["--effort", o.effort] : []),
    "--dangerously-skip-permissions",
    o.prompt,
  ];
}

export type ThinkOpts = {
  agent: Agent; model: string; effort: string;
  cwd?: string; timeoutMs: number;
};

/**
 * Jalankan lead sekali dan kembalikan keluaran mentahnya. Melempar saat proses gagal/kehabisan
 * waktu — pemanggil (decide.ts) yang menerjemahkannya jadi baris jejak `gagal` + notifikasi (AC-4).
 *
 * `maxBuffer` dinaikkan: agen yang berpikir panjang mudah melewati 1 MiB default, dan kegagalan
 * ENOBUFS akan terbaca sebagai "lead tak bisa memutuskan" padahal ia sudah selesai.
 */
export function think(prompt: string, o: ThinkOpts): Promise<string> {
  const bin = binFor(o.agent);
  const args = leadArgv({ agent: o.agent, model: o.model, effort: o.effort, prompt });
  return new Promise((resolve, reject) => {
    execFile(bin, args, {
      cwd: o.cwd, timeout: o.timeoutMs, maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8", killSignal: "SIGTERM",
    }, (err, stdout, stderr) => {
      if (err) {
        const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
        reject(new Error(killed ? `lead ${o.agent} kehabisan waktu ${o.timeoutMs} ms` : `lead ${o.agent} gagal: ${(stderr || err.message).trim().slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });
  });
}
