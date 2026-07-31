// SPEC-409 · ADR-0091 · AC-3 · sesi yang sedang disusun keputusannya.
//
// Menyusun satu keputusan bisa memakan puluhan detik (lead adalah agen). Selama itu sesi peminta
// diam dengan marker keputusan terisi — bentuk yang persis sama dengan "mandek menunggu manusia".
// Tanpa penanda ini operator membaca sesi yang justru sedang dilayani sebagai sesi yang terbengkalai.
//
// In-memory dan sengaja begitu: keadaan ini berumur satu panggilan dan tak boleh selamat dari
// restart server (proses lead ikut mati bersamanya — baris yang tertinggal akan berbohong
// selamanya). Cermin `awaiting` di services/notifications.ts. Single-process (ADR-0024).
const deciding = new Set<string>();

export function markDeciding(sessionId: string): void { deciding.add(sessionId); }
export function clearDeciding(sessionId: string): void { deciding.delete(sessionId); }
export function isDeciding(sessionId: string): boolean { return deciding.has(sessionId); }
export function decidingIds(): string[] { return [...deciding]; }
export function __resetDeciding(): void { deciding.clear(); }
