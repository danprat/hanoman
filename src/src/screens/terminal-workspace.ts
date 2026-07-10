// Grup terminal: tiap grup memegang satu Layout dan grid-nya sendiri.
// Murni, tanpa React/DOM, agar teruji langsung — seperti terminal-layout.ts.
//
// Invarian "satu rumah": satu sesi terpasang di ≤1 sel, di ≤1 grup, lintas seluruh workspace.
// L.setCell hanya menjamin keunikan DI DALAM satu layout; lintas-grup ditegakkan di placeInActive.
import * as L from "./terminal-layout";

export type Group = { id: string; name: string; layout: L.Layout };
export type Workspace = { groups: Group[]; active: string };

const newGroup = (name: string): Group => ({ id: crypto.randomUUID(), name, layout: L.emptyLayout() });

export function emptyWorkspace(): Workspace {
  const g = newGroup("Utama");
  return { groups: [g], active: g.id };
}

// `active` bisa menunjuk grup yang sudah lenyap (state lama di localStorage) → jatuh ke grup pertama.
// groups tak pernah kosong: emptyWorkspace mengisi satu, removeGroup menolak membuang yang terakhir.
export const activeGroup = (ws: Workspace): Group =>
  ws.groups.find((g) => g.id === ws.active) ?? ws.groups[0]!;

export function addGroup(ws: Workspace, name: string): Workspace {
  const g = newGroup(name);
  return { groups: [...ws.groups, g], active: g.id };
}

export const renameGroup = (ws: Workspace, id: string, name: string): Workspace =>
  ({ ...ws, groups: ws.groups.map((g) => (g.id === id ? { ...g, name } : g)) });

// Grup terakhir tak bisa dihapus. Sesi di dalamnya tidak di-kill — ia lepas dari cells,
// jadi otomatis keluar dari placedIds dan muncul di tray.
export function removeGroup(ws: Workspace, id: string): Workspace {
  if (ws.groups.length === 1) return ws;
  const groups = ws.groups.filter((g) => g.id !== id);
  if (groups.length === ws.groups.length) return ws;
  return { groups, active: ws.active === id ? groups[0]!.id : ws.active };
}

export const selectGroup = (ws: Workspace, id: string): Workspace =>
  (ws.groups.some((g) => g.id === id) ? { ...ws, active: id } : ws);

export function mapActiveLayout(ws: Workspace, f: (l: L.Layout) => L.Layout): Workspace {
  const act = activeGroup(ws);
  return { ...ws, groups: ws.groups.map((g) => (g.id === act.id ? { ...g, layout: f(g.layout) } : g)) };
}

// Sapu `id` dari layout SEMUA grup lain lebih dulu, baru tulis di sel idx grup aktif.
// L.setCell dengan idx -1 (id tak ada di grup itu) mengembalikan layout apa adanya.
export function placeInActive(ws: Workspace, idx: number, id: string | null): Workspace {
  const act = activeGroup(ws);
  const swept = id === null ? ws.groups : ws.groups.map((g) =>
    g.id === act.id ? g : { ...g, layout: L.setCell(g.layout, g.layout.cells.indexOf(id), null) });
  return { ...ws, groups: swept.map((g) => (g.id === act.id ? { ...g, layout: L.setCell(g.layout, idx, id) } : g)) };
}

// Grid aktif penuh → workspace apa adanya (sesi tinggal di tray).
export function placeFirstEmptyInActive(ws: Workspace, id: string): Workspace {
  const idx = activeGroup(ws).layout.cells.indexOf(null);
  return idx === -1 ? ws : placeInActive(ws, idx, id);
}

// Lepas dari grup mana pun ia berada — tombol "lepas" ada di grid aktif, tapi menjaga
// invarian lebih murah daripada mengasumsikan sesi selalu ada di grup yang sedang dilihat.
export const detach = (ws: Workspace, id: string): Workspace =>
  ({ ...ws, groups: ws.groups.map((g) => ({ ...g, layout: L.setCell(g.layout, g.layout.cells.indexOf(id), null) })) });

// Tray = sessions − placedIds. Menutup kolom/baris & menghapus grup membuang sel,
// jadi sesinya jatuh ke tray tanpa satu baris kode pembersih pun.
export const placedIds = (ws: Workspace): Set<string> =>
  new Set(ws.groups.flatMap((g) => g.layout.cells.filter((c): c is string => c !== null)));

export const reconcileAll = (ws: Workspace, liveIds: Set<string>): Workspace =>
  ({ ...ws, groups: ws.groups.map((g) => ({ ...g, layout: L.reconcile(g.layout, liveIds) })) });

export const KEY = "hanoman.terminal.workspace";
export const LEGACY_KEY = "hanoman.terminal.layout"; // SPEC-158, satu layout tanpa grup

export function load(): Workspace | null {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return JSON.parse(s) as Workspace;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return null;
    const g: Group = { ...newGroup("Utama"), layout: JSON.parse(legacy) as L.Layout };
    const ws: Workspace = { groups: [g], active: g.id };
    save(ws);
    localStorage.removeItem(LEGACY_KEY);
    return ws;
  } catch { return null; }
}

export function save(ws: Workspace): void {
  try { localStorage.setItem(KEY, JSON.stringify(ws)); } catch { /* mode privat / kuota penuh */ }
}
