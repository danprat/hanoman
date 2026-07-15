import { buildApp } from "./app";
import { prisma } from "./db";
import { startVpsMonitor } from "./services/vps-monitor";

// SPEC-214 · aktifkan git fetch untuk deteksi update hanya di boot server nyata. Test meng-import
// buildApp dari app.ts (tak pernah memuat server.ts), jadi test tak pernah menyentuh jaringan.
process.env.HANOMAN_UPDATE_FETCH ??= "1";

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
  startVpsMonitor(); // healthcheck 5 menit + audit harian (SPEC-164)
  // SPEC-215 · config runtime: muat override DB lalu terapkan (mirror kredensial + init sync client).
  // Tanpa config sync efektif → peran HUB murni (perilaku lama, backward-compatible).
  void (async () => {
    const { loadConfig } = await import("./config");
    const { applyConfigOnBoot } = await import("./services/config-apply");
    await loadConfig();
    await applyConfigOnBoot();
  })();
}).catch((err) => { console.error("listen gagal:", err); process.exit(1); });
