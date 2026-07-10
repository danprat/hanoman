import { buildApp } from "./app";
import { startVpsMonitor } from "./services/vps-monitor";
const app = buildApp();
const port = Number(process.env.PORT ?? 8787);
// Localhost secara default. Sejak SPEC-169 hanoman punya auth (gate 401 di semua /api,
// termasuk upgrade WebSocket /api/terminal), tapi cookie `Secure` butuh TLS — jadi pola
// deploy yang direkomendasikan tetap: bind 127.0.0.1 di belakang reverse proxy (Caddy/nginx)
// yang menerminasi TLS. Set HOST=0.0.0.0 hanya bila ada TLS di depannya (lihat ADR-0028).
const host = process.env.HOST ?? "127.0.0.1";
app.listen({ port, host }).then(() => {
  console.log(`hanoman api ${host}:${port}`);
  startVpsMonitor(); // healthcheck 5 menit + audit harian (SPEC-164)
});
