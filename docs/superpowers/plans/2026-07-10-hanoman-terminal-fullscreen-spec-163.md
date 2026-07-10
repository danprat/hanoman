# SPEC-163 — Layar penuh untuk screen Terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu tombol memaksimalkan grid terminal ke seluruh viewport — sidebar dan topbar tertutup, chrome screen menyusut jadi satu baris, `+ Kolom`/`+ Baris`/`Sesi baru`/tabbar tetap terjangkau.

**Architecture:** Satu `useState<boolean>` di `TerminalScreen`. Saat aktif, root screen jadi `position: fixed; inset: 0; zIndex: 100` yang menimpa `Shell`, dan wrapper chrome membalik `flexDirection` dari `column` jadi `row` sehingga tabbar + toolbar melebur satu baris. Tak ada modul baru, tak ada berkas baru, nol perubahan server/API/skema.

**Tech Stack:** React 18 + TypeScript strict, vitest + @testing-library/react (jsdom), lucide-react (via `ds/icon.tsx`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-10-hanoman-terminal-fullscreen-spec-163-design.md`. Semua keputusan terkunci di sana.

- **BLOKIR — jangan mulai Task 1 sebelum berkas bersih.** Saat plan ini ditulis, sesi Claude lain
  punya perubahan **belum di-commit** untuk SPEC-162 (`PhaseStrip`, `specId`) di
  `src/src/screens/TerminalScreen.tsx`, `src/src/screens/TerminalPane.tsx`, dan `src/src/api/client.ts`.
  `git add <berkas>` menstage **seluruh** berkas, jadi commit SPEC-163 akan menelan pekerjaan
  setengah jadi mereka. Verifikasi dulu:

  ```bash
  git status --short src/src/screens/TerminalScreen.tsx src/src/screens/TerminalPane.tsx src/src/api/client.ts
  ```

  Harus **kosong**. Kalau masih ada ` M`, berhenti dan tunggu — jangan `git stash`, jangan
  `git checkout --`, jangan commit atas nama mereka.

- **JANGAN menulis ulang `TerminalScreen.tsx` seluruhnya.** Berkas ini dibagi dengan sesi lain.
  Pakai Edit ber-anchor (`old_string`/`new_string`) pada potongan yang disebut per step. `Write`
  seluruh berkas akan menghapus `PhaseStrip`/`specId` milik SPEC-162 tanpa suara.

- **`Escape` TIDAK boleh di-bind.** Ia tombol tersibuk di TUI Claude Code (interrupt, keluar mode).
  Tak ada `onKeyDown`, tak ada listener `document`. Keluar hanya lewat tombol. Ada test yang menjaga
  ini; kalau test itu gagal karena seseorang menambahkan handler, handler-nya yang salah.

- **`zIndex: 100`** — bukan angka asal. Tooltip DS `40` (`ds/components/feedback.tsx:130`), modal `150`
  dan toast `200` (`ds/kit.tsx:54,29`). Overlay harus di atas konten, **di bawah** modal dan toast.

- **Tanpa Fullscreen API.** Tak ada `requestFullscreen()`, tak ada `navigator.keyboard.lock`.
  Alasannya di spec.

- **Tanpa persistensi.** `maxed` adalah `useState` biasa, tidak masuk `Workspace` maupun `localStorage`.

- **Bahasa:** komentar, label UI, dan pesan commit dalam bahasa Indonesia, mengikuti berkas di sekitarnya.

- **Perintah test** (env sesi menunjuk production; `env -u` wajib atau test gagal palsu):
  ```bash
  env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx
  ```

- **Jangan `git add -A`, jangan `git stash`.** Checkout ini dibagi. Selalu `git add` berkas yang disebut.

---

### Task 1: Tombol layar penuh + overlay + chrome satu baris

Semua perubahan di satu berkas. Tiga suntingan: state + root container, wrapper chrome + tombol, dan
prop `compact` pada `GroupTabs`.

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx` (tiga anchor, lihat Step 3)
- Modify: `internal/docs/frontend/frontend-implementation.md` (bagian `## Terminal`)
- Test: `src/test/terminal-screen.test.tsx` (tambah `describe` baru di akhir berkas)

**Interfaces:**
- Consumes: `IconButton` dari `../ds` (sudah diekspor di `ds/index.ts:5`); ikon lucide `maximize-2` →
  `Maximize2`, `minimize-2` → `Minimize2` (peta PascalCase di `ds/icon.tsx`). `IconButton` memetakan
  prop `label` → `aria-label` + `title`, dan menyebar `...rest` **setelah** props bawaannya sehingga
  `aria-pressed` sampai ke DOM.
- Produces: root screen ber-`data-testid="terminal-root"`; tombol ber-`aria-label` `"Layar penuh"` /
  `"Keluar layar penuh"` dengan `aria-pressed`.

- [ ] **Step 0: Pastikan berkas bersih (blokir di atas)**

```bash
git status --short src/src/screens/TerminalScreen.tsx src/src/screens/TerminalPane.tsx src/src/api/client.ts
```

Expected: tak ada keluaran. Ada keluaran → **berhenti**, lapor ke pengguna.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `src/test/terminal-screen.test.tsx`, setelah `describe("TerminalScreen (tutup kolom/baris)", …)`:

```tsx
describe("TerminalScreen (layar penuh)", () => {
  const root = () => screen.getByTestId("terminal-root");

  it("tombol memaksimalkan screen, label & aria-pressed berbalik", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);

    const masuk = await screen.findByRole("button", { name: "Layar penuh" });
    expect(masuk).toHaveAttribute("aria-pressed", "false");
    expect(root()).not.toHaveStyle({ position: "fixed" });

    fireEvent.click(masuk);

    expect(root()).toHaveStyle({ position: "fixed", zIndex: "100" });
    expect(screen.getByRole("button", { name: "Keluar layar penuh" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("keluar mengembalikan tinggi normal", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: "Layar penuh" }));

    fireEvent.click(screen.getByRole("button", { name: "Keluar layar penuh" }));

    expect(root()).not.toHaveStyle({ position: "fixed" });
    expect(root()).toHaveStyle({ height: "calc(100vh - 180px)" });
    expect(screen.getByRole("button", { name: "Layar penuh" })).toBeInTheDocument();
  });

  it("kontrol tetap bekerja di dalam layar penuh", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");

    fireEvent.click(screen.getByRole("button", { name: "Layar penuh" }));

    // tabbar, gutter, toolbar: semuanya masih ada setelah chrome dilebur jadi satu baris
    expect(screen.getByRole("tab", { name: "Utama" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tutup kolom 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sesi baru" })).toBeInTheDocument();

    // dan benar-benar terhubung, bukan sekadar ter-render
    fireEvent.click(screen.getByRole("button", { name: "+ Kolom" }));
    expect(await screen.findByLabelText("Tutup kolom 2")).toBeInTheDocument();
    expect(root()).toHaveStyle({ position: "fixed" });   // tetap maximize
  });

  it("Escape TIDAK keluar dari layar penuh — Escape milik terminal", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: "Layar penuh" }));

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(root(), { key: "Escape" });

    expect(root()).toHaveStyle({ position: "fixed" });
    expect(screen.getByRole("button", { name: "Keluar layar penuh" })).toBeInTheDocument();
  });
});
```

Test terakhir menjaga **keputusan**, bukan implementasi: kalau nanti seseorang menambah
`onKeyDown` "biar bisa ditutup dengan Escape", test ini merah dan menjelaskan kenapa.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx
```

Expected: FAIL — 4 kasus baru gagal dengan `Unable to find an accessible element with the role "button" and name "Layar penuh"`. Kasus lama (21, termasuk milik SPEC-162) tetap lolos.

- [ ] **Step 3: Tulis implementasi — tiga Edit ber-anchor**

**Edit 3a — import `IconButton`.** Anchor:

```tsx
import { Button, Select, StateBlock } from "../ds";
```

menjadi:

```tsx
import { Button, IconButton, Select, StateBlock } from "../ds";
```

**Edit 3b — state + root container + wrapper chrome + tombol.** Anchor (dari `const layout =` sampai
penutup `</div>` toolbar):

```tsx
  const layout = W.activeGroup(ws).layout;
  const showEmpty = layout.rows === 1 && layout.cols === 1 && !layout.cells[0] && sessions.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "calc(100vh - 180px)" }}>
      <GroupTabs
        ws={ws}
        onSelect={(id) => setWs((w) => W.selectGroup(w, id))}
        onAdd={() => setWs((w) => W.addGroup(w, `Grup ${w.groups.length + 1}`))}
        onRename={(id, name) => setWs((w) => W.renameGroup(w, id, name))}
        onRemove={(id) => setWs((w) => W.removeGroup(w, id))}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="ghost" onClick={() => setWs((w) => W.mapActiveLayout(w, L.addColumn))}>+ Kolom</Button>
        <Button size="sm" variant="ghost" onClick={() => setWs((w) => W.mapActiveLayout(w, L.addRow))}>+ Baris</Button>
        <div style={{ flex: 1, minWidth: 0 }} />
        <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Button size="sm" leftIcon="plus" onClick={() => void openNew()}>Sesi baru</Button>
      </div>
```

menjadi:

```tsx
  const layout = W.activeGroup(ws).layout;
  const showEmpty = layout.rows === 1 && layout.cols === 1 && !layout.cells[0] && sessions.length === 0;

  // Overlay menimpa Shell, bukan melepas screen darinya. zIndex 100: di atas konten halaman,
  // di bawah modal (150) dan toast (200) di ds/kit.tsx — kalau dibalik, dialog konfirmasi
  // terkubur di belakang terminal.
  // ponytail: Escape sengaja TIDAK di-bind untuk keluar. Ia tombol tersibuk di TUI Claude Code;
  // merebutnya demi menutup overlay menukar hal yang dipakai tiap menit dengan hal yang dipakai
  // sekali. Keluar lewat tombol saja. Ada test yang menjaga ini.
  const rootStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: maxed ? 8 : 12,
    ...(maxed
      ? { position: "fixed", inset: 0, zIndex: 100, background: "var(--surface-page)", padding: 12 }
      : { height: "calc(100vh - 180px)" }),
  };

  return (
    <div data-testid="terminal-root" style={rootStyle}>
      {/* Saat maximize, tabbar & toolbar melebur jadi satu baris supaya ~110px chrome
          kembali ke grid — itu inti permintaannya. */}
      <div style={{ display: "flex", gap: 8,
        flexDirection: maxed ? "row" : "column", alignItems: maxed ? "center" : "stretch" }}>
        <GroupTabs
          compact={maxed}
          ws={ws}
          onSelect={(id) => setWs((w) => W.selectGroup(w, id))}
          onAdd={() => setWs((w) => W.addGroup(w, `Grup ${w.groups.length + 1}`))}
          onRename={(id, name) => setWs((w) => W.renameGroup(w, id, name))}
          onRemove={(id) => setWs((w) => W.removeGroup(w, id))}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          ...(maxed ? { flex: 1, minWidth: 0 } : {}) }}>
          <Button size="sm" variant="ghost" onClick={() => setWs((w) => W.mapActiveLayout(w, L.addColumn))}>+ Kolom</Button>
          <Button size="sm" variant="ghost" onClick={() => setWs((w) => W.mapActiveLayout(w, L.addRow))}>+ Baris</Button>
          <div style={{ flex: 1, minWidth: 0 }} />
          <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          <Button size="sm" leftIcon="plus" onClick={() => void openNew()}>Sesi baru</Button>
          <IconButton size="sm" icon={maxed ? "minimize-2" : "maximize-2"}
            label={maxed ? "Keluar layar penuh" : "Layar penuh"}
            aria-pressed={maxed} onClick={() => setMaxed((m) => !m)} />
        </div>
      </div>
```

Dan tambahkan state-nya. Anchor:

```tsx
  const [project, setProject] = React.useState(projects[0]?.id ?? "");
```

menjadi:

```tsx
  const [project, setProject] = React.useState(projects[0]?.id ?? "");
  const [maxed, setMaxed] = React.useState(false);
```

`rootStyle` dianotasi `React.CSSProperties` supaya `position: "fixed"` tidak melebar jadi `string`
dan ditolak `tsc`. Spread memakai `? {…} : {}`, bukan `&&` — lebih jelas dan bebas dari ketidakpastian
spread boolean.

**Edit 3c — prop `compact` pada `GroupTabs`.** Anchor:

```tsx
function GroupTabs({ ws, onSelect, onAdd, onRename, onRemove }: {
  ws: W.Workspace; onSelect: (id: string) => void; onAdd: () => void;
  onRename: (id: string, name: string) => void; onRemove: (id: string) => void;
}) {
```

menjadi:

```tsx
function GroupTabs({ ws, compact = false, onSelect, onAdd, onRename, onRemove }: {
  ws: W.Workspace; compact?: boolean; onSelect: (id: string) => void; onAdd: () => void;
  onRename: (id: string, name: string) => void; onRemove: (id: string) => void;
}) {
```

dan anchor:

```tsx
    <div role="tablist" aria-label="Grup terminal"
      style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
        borderBottom: "1px solid var(--border-hair)", paddingBottom: 4 }}>
```

menjadi:

```tsx
    <div role="tablist" aria-label="Grup terminal"
      style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
        // Baris digabung → garis bawah tabbar akan memotong baris chrome di tengah.
        ...(compact ? {} : { borderBottom: "1px solid var(--border-hair)", paddingBottom: 4 }) }}>
```

**Jangan sentuh** `Cell`, `PhaseStrip`, `EmptyCell`, `GutterX`, `RenameInput`, atau blok grid.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run test/terminal-screen.test.tsx
```

Expected: PASS — `Tests 25 passed (25)` (21 lama + 4 baru).

Kalau `toHaveStyle({ zIndex: "100" })` gagal: jest-dom membandingkan nilai terkomputasi sebagai
string. Pastikan `zIndex: 100` (angka) di inline style — React menuliskannya `z-index: 100`.

- [ ] **Step 5: Seluruh suite `src` + typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src exec vitest run
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src typecheck
```

Expected: semua berkas test lolos; typecheck exit 0.

- [ ] **Step 6: Perbarui docs yang tersentuh**

Di `internal/docs/frontend/frontend-implementation.md`, bagian `## Terminal (sesi Claude Code
interaktif)`, sisipkan sebelum kalimat `Proxy dev Vite harus memakai `ws: true`…`:

```markdown
Tombol **Layar penuh** (`maximize-2`) di ujung toolbar memaksimalkan screen: root-nya jadi
`position: fixed; inset: 0; z-index: 100`, menimpa sidebar dan topbar `Shell` — di bawah modal (150)
dan toast (200), supaya dialog konfirmasi tak terkubur. Chrome menyusut jadi satu baris (tabbar dan
toolbar melebur, `GroupTabs` kehilangan garis bawahnya lewat prop `compact`) sehingga grid mendapat
sisa layar. Ini **maximize dalam app**, bukan Fullscreen API: `requestFullscreen()` merebut `Escape`,
dan `Escape` adalah tombol tersibuk di TUI Claude Code. Karena itu pula **tak ada** handler `Escape`
untuk keluar — hanya tombol. Pengguna yang mau seluruh layar device menekan `F11` sendiri. State
`maxed` tidak dipersist (SPEC-163).
```

- [ ] **Step 7: Commit**

Periksa sekali lagi bahwa hanya berkas Anda yang berubah — sesi lain mungkin sudah menyentuh
`TerminalPane.tsx`/`client.ts` lagi sejak Step 0:

```bash
git status --short
```

Lalu:

```bash
git add src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx \
        internal/docs/frontend/frontend-implementation.md
git commit -m "feat(terminal): tombol layar penuh, chrome satu baris saat maximize (SPEC-163)"
```

---

### Task 2: Verifikasi nyata di browser + centang checklist

jsdom tak punya mesin layout: ia tak bisa membuktikan overlay benar-benar menutupi sidebar, atau
bahwa sel grid membesar. Itu justru inti fitur ini.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-10-hanoman-terminal-fullscreen-spec-163.md` (centang `- [ ]` → `- [x]`)

Caranya sama seperti SPEC-161 Task 5 — Chrome headless disetir lewat CDP dari skrip Node sekali pakai
di scratchpad, nol dependensi baru (Node 24 punya `WebSocket` + `fetch` global). Jebakan yang sudah
diketahui: app **tak punya routing URL** (screen dicapai dengan mengklik `<div onClick>` di dalam
`<nav>`), Vite mem-proxy `/api` ke **8787**, dan Vite bind ke `localhost` bukan `127.0.0.1`.

- [ ] **Step 1: Boot**

Jalankan dari direktori scratchpad sesi (bukan `/tmp`, bukan dalam repo):

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vite --port 5199 --strictPort &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-first-run --remote-debugging-port=9222 \
  --user-data-dir="$SCRATCH/chrome-profile" about:blank &
```

Vite mencetak `http://localhost:5199/` — pakai `localhost`, `curl` ke `127.0.0.1:5199` gagal.

Pastikan API di 8787 hidup: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/terminal/sessions` → `200`.

- [ ] **Step 2: Sesi uji tanpa risiko**

**Jangan** panggil `POST /terminal/sessions` — ia men-spawn `claude --dangerously-skip-permissions`
sungguhan di working tree yang dibagi sesi lain (`server/src/services/pty.ts:102`). Bikin sesi tmux
sendiri di socket yang sama; `GET /terminal/sessions` melihatnya:

```bash
tmux -L hanoman -f /dev/null new-session -d -s hanoman-fs163 -c /tmp 'sh' \
  \; set-option -t hanoman-fs163 @hanoman_project hanoman \
  \; set-option -t hanoman-fs163 @hanoman_cwd /tmp
```

Ada sesi `claude` hidup milik sesi lain di socket itu — jangan attach, jangan kill.

- [ ] **Step 3: Ukur — sel membesar, sidebar tertutup**

Lewat CDP (`Emulation.setDeviceMetricsOverride` 1440×900), buka Terminal, taruh `fs163` di sel lewat
picker, lalu:

Sel grid **bukan** `children[2]`. Anak container grid berurutan `[pojok, tombol-kolom×cols,
lalu per baris: tombol-baris, sel×cols]` — untuk 1×1 selnya di indeks 3. Jangan hitung indeks; saring
anak yang memuat pane atau picker (jebakan yang sama menipu pengukuran SPEC-161):

```js
const cellRect = () => {
  const grid = document.querySelector('[aria-label="Tutup kolom 1"]').parentElement;
  const cell = [...grid.children].find((k) =>
    k.querySelector(".xterm") || k.querySelector('[aria-label="Pilih sesi untuk sel"]'));
  return cell.getBoundingClientRect();
};
const before = cellRect();
document.querySelector('[aria-label="Layar penuh"]').click();
await new Promise((r) => setTimeout(r, 500));
const after = cellRect();
const aside = document.querySelector("aside").getBoundingClientRect();
const rootZ = getComputedStyle(document.querySelector('[data-testid="terminal-root"]')).zIndex;
```

| Cek | Harapan |
|---|---|
| `after.width > before.width && after.height > before.height` | `true` — grid dapat ruang sidebar+topbar |
| `document.elementFromPoint(aside.left + 10, aside.top + 100)` | **bukan** turunan `<aside>` — overlay menutupinya |
| `rootZ` | `"100"` |
| `.xterm` masih ada, `sessionId` sama | `true` — pane tidak remount |
| `[aria-label="Keluar layar penuh"]` ada | `true` |

- [ ] **Step 4: Escape tetap milik terminal**

```js
document.querySelector(".xterm-helper-textarea")
  .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
```

Expected: `[data-testid="terminal-root"]` **masih** `position: fixed`. Lalu klik
`[aria-label="Keluar layar penuh"]` → kembali normal, sidebar terlihat lagi
(`document.elementFromPoint` di titik sidebar mengembalikan turunan `<aside>`).

- [ ] **Step 5: Screenshot + bersih-bersih**

`Page.captureScreenshot` sebelum dan sesudah maximize. Lalu:

```bash
curl -s -X DELETE http://127.0.0.1:8787/api/terminal/sessions/fs163   # → 204
pkill -f "chrome-profile"
kill $(lsof -nP -iTCP:5199 -sTCP:LISTEN -t)
tmux -L hanoman -f /dev/null ls    # dua sesi claude milik sesi lain harus utuh
```

- [ ] **Step 6: Centang checklist plan & commit**

Ubah `- [ ]` yang sudah dikerjakan jadi `- [x]`, catat hasil ukurannya di Task 2, lalu:

```bash
git add docs/superpowers/plans/2026-07-10-hanoman-terminal-fullscreen-spec-163.md
git commit -m "docs(spec-163): centang checklist + catat verifikasi browser nyata"
```

Langkah verifikasi yang gagal: **perbaiki dulu sampai hijau**. Jangan centang yang tak dijalankan.
