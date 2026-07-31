// SPEC-408 · ADR-0090 · rentang tanggal untuk filter backlog. Murni, nol dependensi, nol I/O —
// gampang diuji dan tak menyeret Prisma ke test.
//
// Kenapa parsing manual, bukan `new Date(s)`: `new Date("2026-07-31")` di-spec ECMAScript sebagai
// tengah malam **UTC**. Dipakai sebagai batas `to`, ia membuang hampir seluruh hari 31 Juli untuk
// operator di zona timur (WIB = UTC+7). Operator memilih tanggal di kalendernya sendiri, jadi
// batasnya harus hari LOKAL.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Awal hari lokal untuk `YYYY-MM-DD`. `null` bila bukan tanggal kalender yang valid. */
export function dayStart(s: string | undefined | null): Date | null {
  if (!s || !DAY.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  // `new Date(2026, 12, 1)` menggulir ke Januari 2027 tanpa error — tolak yang tak sesuai input,
  // supaya "2026-02-30" jadi filter mati, bukan filter yang diam-diam menunjuk 2 Maret.
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** Akhir hari lokal (23:59:59.999) untuk `YYYY-MM-DD` — batas `to` yang INKLUSIF. */
export function dayEnd(s: string | undefined | null): Date | null {
  const start = dayStart(s);
  if (!start) return null;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
}

/**
 * Inklusif di kedua ujung; batas `null` = terbuka. Tanpa rentang aktif semuanya lolos.
 * `at` null (mis. `startedAt` item yang belum pernah dikerjakan) TIDAK lolos begitu ada
 * rentang aktif — item tanpa tanggal tak bisa berada di dalam rentang tanggal.
 */
export function inDayRange(at: Date | null | undefined, from: Date | null, to: Date | null): boolean {
  if (!from && !to) return true;
  if (!at) return false;
  const t = at.getTime();
  return (!from || t >= from.getTime()) && (!to || t <= to.getTime());
}
