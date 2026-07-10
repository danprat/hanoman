import { buildApp } from "./app";
import { startVpsMonitor } from "./services/vps-monitor";
const app = buildApp();
const port = Number(process.env.PORT ?? 8787);
// Localhost secara default. hanoman tidak punya auth, dan /api/terminal menyerahkan
// PTY sungguhan — bind ke 0.0.0.0 berarti membagikan shell ke seluruh jaringan.
// Override lewat HOST hanya bila ada lapisan autentikasi di depannya.
const host = process.env.HOST ?? "127.0.0.1";
app.listen({ port, host }).then(() => {
  console.log(`hanoman api ${host}:${port}`);
  startVpsMonitor(); // healthcheck 5 menit + audit harian (SPEC-164)
});
