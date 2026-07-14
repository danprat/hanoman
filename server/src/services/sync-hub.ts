import type { Client } from "./pty";
import { setAcceptedHook } from "./sync";

// SPEC-213 · ADR-0046 · siar changefeed sync ke instance client terhubung. Meniru pola siar
// services/events.ts: satu Set klien, frame lahir saat SyncLog di-append (accepted write).
const clients = new Set<Client>();

export function attachSync(c: Client): void { clients.add(c); }
export function detachSync(c: Client): void { clients.delete(c); }

export function broadcastSyncLog(row: { entity: string; recordId: string; version: number; data: unknown; seq: string }): void {
  const s = JSON.stringify({ t: "sync", ...row });
  for (const c of clients) { try { c.send(s); } catch { clients.delete(c); } }
}

// Sambungkan hook accepted-write service sync ke siar. Idempoten (dipanggil sekali saat modul
// dimuat oleh route sync). Nol dependency di service sync itu sendiri.
setAcceptedHook((row) => broadcastSyncLog(row));

// Test-only: kosongkan klien.
export function __resetSyncHub(): void { clients.clear(); }
