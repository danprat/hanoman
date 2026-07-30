import { buildApp } from "./app";
import { prisma } from "./db";
import { startVpsMonitor } from "./services/vps-monitor";
import { startScheduler } from "./services/scheduler/engine";
import { registerBacklogSource } from "./services/scheduler/sources/backlog";
import { registerErrorsSource } from "./services/scheduler/sources/errors";
import { registerTriaseSource } from "./services/scheduler/sources/triase";
import { installSessionHistory, reconcileHistory } from "./services/session-history";
import { listSessions } from "./services/pty";

// SPEC-215 · deteksi update default ON (registry HANOMAN_UPDATE_FETCH="1"), dibaca via resolver
// di services/update.ts. Test memuat buildApp dari app.ts (tak pernah server.ts) dan vitest.config
// memaksa "0" → tak pernah menyentuh jaringan.
const app = buildApp();
const port = Number(process.env.PORT ?? 8787);
// Localhost secara default. Sejak SPEC-169 hanoman punya auth (gate 401 di semua /api,
// termasuk upgrade WebSocket /api/terminal), tapi cookie `Secure` butuh TLS — jadi pola
// deploy yang direkomendasikan tetap: bind 127.0.0.1 di belakang reverse proxy (Caddy/nginx)
// yang menerminasi TLS. Set HOST=0.0.0.0 hanya bila ada TLS di depannya (lihat ADR-0028).
const host = process.env.HOST ?? "127.0.0.1";

// Jangan biarkan satu promise yatim (mis. sweep monitor saat DB kedip) menjatuhkan orchestrator
// tanpa jejak (SPEC-197). Log, jangan crash.
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

// Tutup rapi: onClose (app.ts) melepas klien tmux; sesi claude selamat — hidup di tmux server,
// bukan proses ini (ADR-0016). Lalu putus Prisma agar koneksi tak menggantung saat restart.
async function shutdown(sig: string): Promise<void> {
  console.log(`${sig} — menutup`);
  try { await app.close(); await prisma.$disconnect(); } finally { process.exit(0); }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

app.listen({ port, host }).then(() => {
  console.log(`hanoman api ${host}:${port}`);
  // SPEC-362 · ADR-0079 · pasang hook riwayat SEBELUM apa pun bisa melahirkan sesi, lalu tutup
  // baris "berjalan" yang panenya sudah lenyap (tmux mati di luar hanoman: kill-server, reboot).
  installSessionHistory();
  // SPEC-402 · `listSessions()` boleh MELEMPAR (kegagalan tmux ≠ tak ada sesi). Rekonsiliasi yang
  // berjalan atas daftar kosong palsu akan menutup baris riwayat sesi yang justru masih berjalan —
  // "selesai padahal belum" versi tabel. Lewati saja: barisnya tetap terbuka sampai boot berikutnya.
  try {
    const liveIds = listSessions().map((s) => s.id);
    void reconcileHistory(liveIds)
      .then((n) => { if (n) console.log(`riwayat sesi: ${n} baris berjalan direkonsiliasi`); })
      .catch((e) => console.error("rekonsiliasi riwayat sesi:", e));
  } catch (e) {
    console.error("rekonsiliasi riwayat sesi dilewati — tmux tak terbaca:", e);
  }
  startVpsMonitor(); // healthcheck 5 menit + audit harian (SPEC-164)
  registerBacklogSource(); // SPEC-295 · daftarkan checker backlog sebelum engine tick pertama
  registerErrorsSource(); // SPEC-296 · daftarkan checker errors sebelum engine tick pertama
  registerTriaseSource(); // SPEC-297 · daftarkan checker triase sebelum engine tick pertama
  startScheduler(); // SPEC-294 · ADR-0072 · engine scheduler in-process (timer .unref, app.ts bebas-timer)
  // SPEC-215 · config runtime: muat override DB lalu terapkan (mirror kredensial + init sync client).
  // Tanpa config sync efektif → peran HUB murni (perilaku lama, backward-compatible).
  void (async () => {
    const { loadConfig } = await import("./config");
    const { applyConfigOnBoot } = await import("./services/config-apply");
    await loadConfig();
    await applyConfigOnBoot();
  })();
}).catch((err) => { console.error("listen gagal:", err); process.exit(1); });
