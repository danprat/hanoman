// State layout grid terminal — murni, tanpa React/DOM, agar teruji langsung.
// cells baris-mayor: idx = r*cols + c, panjang selalu rows*cols.
export type Layout = { rows: number; cols: number; cells: (string | null)[] };

export const emptyLayout = (): Layout => ({ rows: 1, cols: 1, cells: [null] });

// + Baris: append satu baris (cols sel kosong). Index sel lama TAK bergeser.
export const addRow = (l: Layout): Layout =>
  ({ ...l, rows: l.rows + 1, cells: [...l.cells, ...Array<string | null>(l.cols).fill(null)] });

// + Kolom: idx = r*cols + c BERGESER saat cols berubah — jadi cells di-rebuild, bukan di-append.
// Menyamakannya dengan addRow (append) akan mengacak isi sel; itu sebabnya keduanya diuji terpisah.
export function addColumn(l: Layout): Layout {
  const cols = l.cols + 1;
  const cells: (string | null)[] = [];
  for (let r = 0; r < l.rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push(c < l.cols ? l.cells[r * l.cols + c] : null);
  return { rows: l.rows, cols, cells };
}

// Taruh sesi di sel idx; kosongkan sel lain yang memegang id sama (satu sesi ≤ satu sel).
// id null = kosongkan idx saja. idx di luar rentang → layout apa adanya (mis. detach id tak tertempat).
export function setCell(l: Layout, idx: number, id: string | null): Layout {
  if (idx < 0 || idx >= l.cells.length) return l;
  const cells = l.cells.map((c) => (id !== null && c === id ? null : c));
  cells[idx] = id;
  return { ...l, cells };
}

// Taruh di sel kosong pertama; penuh → layout apa adanya (sesi tinggal di tray).
export function placeFirstEmpty(l: Layout, id: string): Layout {
  const idx = l.cells.indexOf(null);
  return idx === -1 ? l : setCell(l, idx, id);
}

// Sesi yang lenyap dari server (di-kill) dikosongkan. Sesi `exited` TETAP di liveIds
// (listSessions memuat pane mati), jadi ia tetap terikat dan tampil "berakhir".
export const reconcile = (l: Layout, liveIds: Set<string>): Layout =>
  ({ ...l, cells: l.cells.map((c) => (c && liveIds.has(c) ? c : null)) });

const KEY = "hanoman.terminal.layout";
export function load(): Layout | null {
  try { const s = localStorage.getItem(KEY); return s ? (JSON.parse(s) as Layout) : null; }
  catch { return null; }
}
export function save(l: Layout): void {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* mode privat / kuota penuh */ }
}
