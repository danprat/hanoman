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

/**
 * SPEC-479 (QA) · sesi yang sudah meminta putusan tapi belum dapat slot gerbang (`gate.ts`).
 *
 * Keadaan KETIGA, sengaja terpisah dari `deciding`: di pane, "menunggu manusia", "sedang
 * diputuskan", dan "menunggu giliran" terlihat persis sama — marker terisi, agen diam — tetapi
 * hanya yang pertama yang butuh manusia. Menyatukan antre dengan `deciding` akan menyembunyikan
 * satu-satunya hal yang perlu dilihat operator saat lead penuh: bahwa batasnya sedang mengikat.
 * Justru salah baca itu yang melahirkan tiket SPEC-479.
 *
 * In-memory dengan alasan yang sama seperti `deciding`: keadaan ini berumur satu panggilan dan
 * mati bersama proses lead. Single-process (ADR-0024).
 */
const queued = new Set<string>();

export function markQueued(sessionId: string): void { queued.add(sessionId); }
export function clearQueued(sessionId: string): void { queued.delete(sessionId); }
export function queuedIds(): string[] { return [...queued]; }

export function __resetDeciding(): void { deciding.clear(); queued.clear(); }
