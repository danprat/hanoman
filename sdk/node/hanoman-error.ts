// SPEC-249 · ADR-0060 · helper Node/TS untuk mengirim error ke hanoman (Sentry ringan).
// Copy-paste ke project-mu (belum dipublish ke npm). Fire-and-forget: hanoman down ≠ app crash.
//
// Pemakaian:
//   import { initHanomanErrors, captureError } from "./hanoman-error";
//   initHanomanErrors({ dsn: process.env.HANOMAN_DSN!, environment: "production", release: "1.2.3" });
//   // error tak tertangani terkirim otomatis; atau manual:
//   try { risky(); } catch (e) { captureError(e, { route: "/checkout" }); }

type InitOpts = { dsn: string; environment?: string; release?: string };
let cfg: InitOpts | null = null;

function post(body: unknown): void {
  if (!cfg) return;
  try {
    // keepalive tak wajib di Node; fetch global tersedia sejak Node 18.
    void fetch(cfg.dsn, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => { /* telan: hanoman down tak boleh menjatuhkan app */ });
  } catch { /* fetch tak ada / error sinkron — abaikan */ }
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const e = err as { name?: string; message?: string; stack?: string };
  post({
    type: e?.name || "Error",
    message: e?.message || String(err),
    stack: e?.stack,
    environment: cfg?.environment,
    release: cfg?.release,
    context,
  });
}

export function initHanomanErrors(opts: InitOpts): void {
  cfg = opts;
  process.on("uncaughtException", (e) => captureError(e));
  process.on("unhandledRejection", (e) => captureError(e));
}
