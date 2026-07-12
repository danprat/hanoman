import { paths, type EventMsg } from "@hanoman/shared";

// SPEC-199 · satu koneksi WS dibagi semua consumer (ref-count, pola api/limits.ts). Server
// mendorong frame per-grup; tiap consumer filter berdasarkan msg.t. Reconnect backoff +
// tutup saat tab hidden (server kirim snapshot penuh tiap connect → state re-sync sendiri).
const subs = new Set<(m: EventMsg) => void>();
let ws: WebSocket | undefined;
let backoff = 500;
let intentionalClose = false;

function open(): void {
  if (ws || (typeof document !== "undefined" && document.hidden)) return;
  intentionalClose = false;
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${scheme}//${location.host}${paths.eventsWs}`);
  ws.onopen = () => { backoff = 500; };
  ws.onmessage = (ev) => {
    let m: EventMsg;
    try { m = JSON.parse(ev.data as string); } catch { return; }
    for (const s of subs) s(m);
  };
  ws.onclose = () => {
    ws = undefined;
    if (!intentionalClose && subs.size) {
      setTimeout(() => { if (subs.size) open(); }, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    }
  };
  ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
}

function close(): void { intentionalClose = true; try { ws?.close(); } catch { /* noop */ } ws = undefined; }

function onVisibility(): void {
  if (document.hidden) close();
  else if (subs.size) open();
}

export function subscribe(handler: (m: EventMsg) => void): () => void {
  subs.add(handler);
  if (subs.size === 1) {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    open();
  }
  return () => {
    subs.delete(handler);
    if (subs.size === 0) {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      close();
    }
  };
}
