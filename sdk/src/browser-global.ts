// Global IIFE: <script src="hanoman.global.js"></script> setelah set window.HANOMAN_DSN.
// window.HANOMAN_DSN = "https://host/api/ingest/<slug>?key=hnm_ing_..."
// window.HANOMAN_OPTS = { environment, release }   (opsional)
import { init } from "./index";

const w = globalThis as { HANOMAN_DSN?: string; HANOMAN_OPTS?: { environment?: string; release?: string } };
if (w.HANOMAN_DSN) {
  init({ dsn: w.HANOMAN_DSN, environment: w.HANOMAN_OPTS?.environment, release: w.HANOMAN_OPTS?.release });
}
