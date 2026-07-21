// hanoman-sdk core — transport + config + captureError. Isomorphic, fire-and-forget.
// Akses global via cast `globalThis` (tanpa @types/node / DOM lib) → dependency-free.
import { collectStack, framesFromStack } from "./stack";
export type InitOpts = { dsn?: string; environment?: string; release?: string };

type FetchFn = (url: string, init: unknown) => { catch: (cb: () => void) => unknown };

let cfg: InitOpts | null = null;

export function configure(opts: InitOpts): void { cfg = opts; }
export function currentConfig(): InitOpts | null { return cfg; }

export function send(body: Record<string, unknown>): void {
  const c = cfg;
  if (!c || !c.dsn) return; // tak terkonfigurasi → no-op senyap
  try {
    const f = (globalThis as { fetch?: FetchFn }).fetch;
    if (!f) return; // fetch absen (Node < 18 tanpa polyfill) → menyerah diam
    void f(c.dsn, {
      method: "POST",
      keepalive: true, // browser: kirim tetap jalan saat unload; Node: diabaikan
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => { /* telan: hanoman down ≠ app crash */ });
  } catch { /* fetch throw sinkron — abaikan */ }
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const c = cfg;
  const e = err as { name?: string; message?: string };
  const stack = collectStack(err);
  send({
    type: e?.name || "Error",
    message: e?.message || String(err),
    stack,
    frames: framesFromStack(stack),
    environment: c?.environment,
    release: c?.release,
    context,
  });
}
