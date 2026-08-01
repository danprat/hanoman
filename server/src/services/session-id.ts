// tmux menolak `.` dan `:` dalam nama sesi. Sesi backlog id-nya bisa ditebak dari spec-nya —
// itulah yang membuat Start dua kali menyambung ke sesi yang sama, bukan melahirkan yang kedua.
// SPEC-294 · satu definisi dipakai terminal route, session-launch, dan governor scheduler —
// tak ada divergensi id sesi antar jalur peluncuran.
//
// SPEC-475 · hidup di modul sendiri (bukan lagi di `pty.ts`) supaya resolver dependency
// `spec-deps.ts` bisa menurunkan nama branch sesi — `hanoman/<sessionIdForSpec(id)>`, ADR-0032 —
// tanpa ikut menarik `node-pty` beserta binding nativenya. `pty.ts` me-re-export-nya, jadi seluruh
// pemakai lama tak berubah dan tetap ada SATU definisi.
export const sessionIdForSpec = (specId: string): string =>
  specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
