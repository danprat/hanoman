// hanoman-sdk public API. init() memasang auto-handler sesuai runtime, lalu configure().
import { captureError, configure } from "./core";
import type { InitOpts } from "./core";

export type { InitOpts };
export { captureError };

function browserContext(): Record<string, unknown> | undefined {
  const loc = (globalThis as { location?: { href?: string } }).location;
  return loc?.href ? { url: loc.href } : undefined;
}

function installBrowserHandlers(): void {
  const g = globalThis as { addEventListener?: (t: string, cb: (e: unknown) => void) => void };
  if (typeof g.addEventListener !== "function") return;
  g.addEventListener("error", (e: unknown) => {
    const ev = e as { error?: { name?: string; stack?: string }; message?: string };
    const err = ev.error || {};
    captureError({ name: err.name || "Error", message: ev.message || "Error", stack: err.stack }, browserContext());
  });
  g.addEventListener("unhandledrejection", (e: unknown) => {
    const ev = e as { reason?: { name?: string; message?: string; stack?: string } };
    const r = ev.reason || {};
    captureError({ name: r.name || "UnhandledRejection", message: r.message || String(r), stack: r.stack }, browserContext());
  });
}

function installNodeHandlers(): void {
  const p = (globalThis as { process?: { on?: (e: string, cb: (x: unknown) => void) => void } }).process;
  if (!p || typeof p.on !== "function") return;
  p.on("uncaughtException", (e: unknown) => captureError(e));
  p.on("unhandledRejection", (e: unknown) => captureError(e));
}

export function init(opts: InitOpts): void {
  configure(opts);
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") installBrowserHandlers();
  else installNodeHandlers();
}

export const initHanomanErrors = init;

const hanoman = { init, captureError, initHanomanErrors };
export default hanoman;
