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

// SPEC-432 · SATU penjaga untuk kedua irama adalah cara kedua irama itu batal dipisahkan. Denyut
// proaktif bisa memakan menit (di mesin operator: 3 project × timeoutSec = 360 dtk), dan selama itu
// `if (busy) return` membuat setiap tick 5 detik pulang tanpa menjalankan pintu deteksi — pintu
// yang justru satu-satunya penjawab sesi mandek. Karena itu penjaganya satu per pekerjaan.
let busyDetect = false;
let busyPulse = false;

// `lastPulseAt` = denyut terakhir DIMULAI (dibaca `/lead/status`). `pulseEndedAt` = denyut terakhir
// SELESAI, dan jatuh-temponya dihitung dari yang paling belakang di antara keduanya: menstempel
// hanya di awal membuat denyut yang lebih lama dari `everyMin` langsung jatuh tempo lagi begitu ia
// selesai — `everyMin` berhenti jadi lantai, dan denyut berikutnya menyentuh git tanpa jeda.
let lastPulseAt = 0;
let pulseEndedAt = 0;
let timer: NodeJS.Timeout | undefined;

export function lastPulse(): number { return lastPulseAt; }
export function __resetEngine(): void {
  lastPulseAt = 0; pulseEndedAt = 0; busyDetect = false; busyPulse = false;
}

export type LeadTickDeps = {
  detect?: DetectDeps;
  pulse?: PulseDeps;
  /** Jam untuk menstempel AKHIR denyut. Di-inject agar jeda "sejak selesai" teruji deterministik. */
  now?: () => number;
};

/**
 * Satu tick. `now` di-parameter agar cadence teruji deterministik (pola scheduler engine).
 *
 * Dua pekerjaan dijalankan BERDAMPINGAN, masing-masing dengan penjaga re-entrancy sendiri: satu
 * denyut yang lambat tak boleh melewatkan satu pun putaran pintu deteksi (ADR-0091 §5 memisahkan
 * kedua irama justru karena ongkos & urgensinya berbeda).
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
  let cfg;
  try { cfg = await getLead(); }
  catch (e) { console.error("lead tick:", e); return; }
  if (!cfg.enabled) return;            // AC-30 · master switch mati → hanoman apa adanya

  const jobs: Promise<void>[] = [];

  if (!busyDetect) {
    busyDetect = true;
    jobs.push(scanAndAnswer(deps.detect ?? prodDetectDeps)
      .then(() => { /* hasilnya dipakai test, bukan engine */ })
      .catch((e) => { console.error("lead detect:", e); })
      .finally(() => { busyDetect = false; }));
  }

  // Rem darurat: denyut proaktif ikut diam saat Pause. Pintu deteksi punya gerbangnya sendiri.
  if (!cfg.paused && !busyPulse && now - Math.max(lastPulseAt, pulseEndedAt) >= cfg.everyMin * 60_000) {
    busyPulse = true;
    lastPulseAt = now;
    const clock = deps.now ?? Date.now;
    jobs.push(pulse(deps.pulse ?? prodPulseDeps)
      .then(() => { /* idem */ })
      .catch((e) => { console.error("lead pulse:", e); })
      .finally(() => { pulseEndedAt = clock(); busyPulse = false; }));
  }

  await Promise.all(jobs);
}

// Dipanggil server.ts SAJA (app.ts bebas-timer, seperti scheduler). unref → tak menahan proses.
export function startLead(deps: LeadTickDeps = {}): void {
  if (timer) return;
  timer = setInterval(() => void tick(Date.now(), deps), TICK_MS);
  timer.unref();
  void tick(Date.now(), deps);
}
export function stopLead(): void { if (timer) clearInterval(timer); timer = undefined; }
