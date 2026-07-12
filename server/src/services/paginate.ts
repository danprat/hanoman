import type { Paginated } from "@hanoman/shared";

// SPEC-198 · paginasi murni di layer response. Tanpa limit → seluruh item (page 1,
// pageSize=total) — dipakai full-fetch App, board, dan poll. Dipakai GET /specs & /projects;
// keduanya memuat set penuh dulu (overlay/aggregate) lalu memotong RESPONS di sini.
export function paginate<T>(items: T[], page?: string, limit?: string): Paginated<T> {
  const total = items.length;
  const pageSize = limit ? Math.max(1, Math.floor(+limit) || 1) : total;
  const p = page ? Math.max(1, Math.floor(+page) || 1) : 1;
  const start = (p - 1) * pageSize;
  return { items: pageSize ? items.slice(start, start + pageSize) : items, total, page: p, pageSize };
}
