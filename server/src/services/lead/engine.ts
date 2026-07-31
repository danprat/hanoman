import { getLead } from "./config";
import { scanAndAnswer, prodDetectDeps, type DetectDeps } from "./detect";
import { pulse, prodPulseDeps, type PulseDeps } from "./pulse";

// SPEC-409 · ADR-0091 · AC-12 · denyut hanoman-lead: `setInterval` di dalam proses server, cermin
// engine scheduler (ADR-0072) dan monitor VPS. TANPA message queue, worker terpisah, atau cron
// eksternal (ADR-0024 tetap utuh) dan TANPA kanal WebSocket baru (ADR-0039 tetap utuh).
//
// Dua irama, sengaja berbeda:
// - Pintu deteksi otomatis tiap TICK (5 dtk). Sesi yang mandek adalah masalah yang diukur dalam
//   MENIT (M1: median ≤ 2 menit), jadi ia harus dilihat sesering mungkin; biayanya satu
//   `tmux list-panes` + satu `stat` per sesi selama tak ada yang menunggu — nol panggilan agen.
// - Denyut proaktif tiap `lead.everyMin` (default 5 menit). Ia menyentuh git & bisa memanggil agen,
//   jadi ia tak boleh ikut irama 5 detik.
const TICK_MS = 5_000;

let lastPulseAt = 0;
let busy = false;
let timer: NodeJS.Timeout | undefined;

export function lastPulse(): number { return lastPulseAt; }
export function __resetEngine(): void { lastPulseAt = 0; busy = false; }

export type LeadTickDeps = { detect?: DetectDeps; pulse?: PulseDeps };

/**
 * Satu tick. `now` di-parameter agar cadence teruji deterministik (pola scheduler engine).
 *
 * AC-27 · Pause menghentikan keputusan BARU: master switch & Pause dibaca ulang di sini, di
 * `scanAndAnswer`, DAN di `decide()` — jadi keputusan berikutnya tak pernah lolos lebih dari satu
 * tick sesudah operator menekan Pause. Yang sedang berjalan dibiarkan selesai; sesi yang sedang
 * bekerja tak disentuh sama sekali.
 *
 * AC-37 · seluruh isinya dibungkus try/catch: lead yang mati (agennya crash, kuota habis, git
 * gagal) tak boleh menjatuhkan proses server maupun menghentikan sesi yang sedang berjalan —
 * sesi hanya kembali ke perilaku menunggu manusia seperti sebelum PRD ini.
 */
export async function tick(now: number, deps: LeadTickDeps = {}): Promise<void> {
  if (busy) return;                    // satu putaran bisa memakan menit (lead adalah agen)
  busy = true;
  try {
    const cfg = await getLead();
    if (!cfg.enabled) return;          // AC-30 · master switch mati → hanoman apa adanya
    try { await scanAndAnswer(deps.detect ?? prodDetectDeps); }
    catch (e) { console.error("lead detect:", e); }
    if (cfg.paused) return;            // rem darurat: denyut proaktif ikut diam
    if (now - lastPulseAt < cfg.everyMin * 60_000) return;
    lastPulseAt = now;
    try { await pulse(deps.pulse ?? prodPulseDeps); }
    catch (e) { console.error("lead pulse:", e); }
  } catch (e) {
    console.error("lead tick:", e);
  } finally { busy = false; }
}

// Dipanggil server.ts SAJA (app.ts bebas-timer, seperti scheduler). unref → tak menahan proses.
export function startLead(deps: LeadTickDeps = {}): void {
  if (timer) return;
  timer = setInterval(() => void tick(Date.now(), deps), TICK_MS);
  timer.unref();
  void tick(Date.now(), deps);
}
export function stopLead(): void { if (timer) clearInterval(timer); timer = undefined; }
