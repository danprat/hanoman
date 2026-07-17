# Desain — VPS Checklist ke Modal + Collapse/Expand Seksi + Search/Filter

> Tanggal: 2026-07-17 · Frontend-only (React+TS, `src/`). Tanpa perubahan server/skema/API.
> Lanjutan UI dari SPEC-220/221 (`ChecklistView` sudah dihidrasi penuh oleh server).

## Objective

Memindahkan **detail VPS checklist** dari panel inline di bawah daftar VPS menjadi **modal** yang lebih leluasa, dengan tiap **grouping seksi bisa collapse/expand** (default **collapsed** agar mudah di-track saat pertama membuka), plus **search** dan mempertahankan **filter** yang sudah ada.

Murni pekerjaan tampilan/UX. Tidak menyentuh endpoint, DTO, katalog, scoring, maupun skema. Semua fungsi existing (N/A, attest, remediasi selektif, saran app-layer, banner drift, skor) dipertahankan — hanya berpindah tempat ke dalam modal.

## Keputusan terkunci (dari brainstorming)

1. **Trigger modal:** klik baris VPS tetap menampilkan **ringkasan ringan inline** (nama, skor total + bar, "audit terakhir", disk/mem/load); ada tombol **`📋 Checklist`** yang membuka modal detail. Baris = ringkas, modal = dalam.
2. **Header seksi saat collapsed:** informatif — `▶ ikon  judul   skor%  • N fail M warn  ⚠ drift`. Bisa melihat seksi bermasalah tanpa expand.

## Konteks kode saat ini (fakta)

- `src/src/screens/VpsChecklist.tsx` — komponen konten checklist: fetch `api.vpsChecklist(vpsId)`, state `filter` (seksi/mode/status/severity), `selected` (item AUTO), `preview` (dry-run), aksi N/A/attest/remediasi/bulk-N/A. Merender skor total, banner drift, baris filter, lalu seksi + `ItemRow`.
- `src/src/screens/VpsScreen.tsx:194-206` — panel inline `{selected && (...)}` yang membungkus `<VpsChecklist>` di bawah daftar VPS.
- `src/src/ds/kit.tsx:42` — primitive `Modal({ open, title, eyebrow, icon, onClose, footer, width=560, children })`: Esc & klik backdrop menutup, `maxHeight:88vh`, area konten `overflow:auto`. Contoh pemakaian konten besar: `SpecDocsModal` (`width={900}`).
- DTO `dto.ts:161-179`: `ChecklistItem { id, section, sectionTitle, level, title, code?, mode, severity, status, na, attested, drifted, actorEmail, naReason, attestNote }`, `ChecklistSection { id, title, icon, score, suggestion?, items }`, `ChecklistView { vpsId, scoreTotal, scoreBySection, lastAuditAt, sections }`.
- Test existing: `src/test/vps-checklist.test.tsx` (141 baris) merender komponen langsung.

## Arsitektur komponen

- **`VpsChecklistModal`** (di `src/src/screens/VpsChecklist.tsx`, mengganti export `VpsChecklist`): props `{ vpsId, onClose, onToast }`. Membungkus konten yang ada di dalam `<Modal open width={960} icon="clipboard-list" title=<nama/"Checklist kepatuhan"> onClose>`. Memegang state: `view`, `status`, `filter`, `search`, `expanded`, `selected`, `preview`, `action`, `busy`.
  - **Toolbar** (di atas konten modal): skor total + `ScoreBar`; banner drift bila `driftCount>0`; baris kontrol = **input search** + 4 `Select` filter existing + tombol Reset (muncul bila ada filter/search aktif). Bulk-remediasi bar + blok preview dry-run tetap, di bawah toolbar.
  - **Daftar seksi**: memetakan `sections` ke `SectionGroup`.
- **`SectionGroup`** (sub-komponen baru): props `{ section, expanded, onToggle, counts, filtering, busy, selected, onToggleItem, onNa, onAttest, onSectionNa }`. Merender header collapsible (chevron + ikon + judul + `ScoreBar` + hitungan/badge) dan — bila `expanded` — daftar `ItemRow` + blok saran app-layer.
- `ItemRow`, `ScoreBar`, `Badge`, `Select` dipertahankan apa adanya.
- **`VpsScreen.tsx`**: ganti isi panel `{selected && (...)}` menjadi ringkasan ringan + tombol `Checklist`; tambah state `checklistOpen: boolean`; render `{checklistOpen && selected && <VpsChecklistModal vpsId={selected.id} onClose={() => setChecklistOpen(false)} onToast={onToast} />}`.

## Perilaku detail

**Collapse/expand**
- State `expanded: Set<sectionId>`, inisialisasi **kosong** (semua collapsed) saat modal dibuka (`useEffect` reset pada `vpsId`).
- Klik header men-toggle id di `expanded`.

**Header seksi (selalu tampil, collapsed maupun expanded)**
- Chevron `▶` (collapsed) / `▼` (expanded), `section.icon`, `section.title`, `ScoreBar score={section.score}`.
- Hitungan dari **item penuh seksi** (bukan hasil filter) agar jadi indikator kesehatan stabil: `fail`, `warn` (dan `unknown` bila ada). Bila tak ada fail/warn/unknown → teks "semua pass".
- Badge `⚠ drift` bila ada item `drifted` di seksi. Badge `saran N/A` bila `section.suggestion && !section.suggestion.applicable`.

**Search + filter + auto-expand**
- `search` (string): cocokkan `item.title`, `item.id`, `item.code` (lowercase `includes`). Di-AND-kan dengan `match()` existing (seksi/mode/status/severity).
- `filtering = search.trim() !== "" || filter.section||filter.mode||filter.status||filter.severity`.
- `useEffect` pada perubahan (`search`,`filter`): bila `filtering` → `setExpanded(new Set(idSeksiYangPunyaItemCocok))`; bila semua kontrol bersih → `setExpanded(new Set())` (collapse semua). Toggle manual tetap berfungsi di antara perubahan.
- Item yang tampil di seksi = hasil match; seksi tanpa item cocok **disembunyikan** selama memfilter.
- Bila filter/search menghasilkan nol item di semua seksi → `StateBlock kind="empty"` ringkas di dalam modal.

**Fungsi dipertahankan (pindah ke modal, tak ada yang hilang)**
- N/A & Batal-N/A per item; Attest (INFO); pilih item AUTO → Preview (dry-run) & Apply remediasi (konfirmasi + audit ulang); saran app-layer + bulk "Tandai seksi N/A"; banner drift; skor total & per-seksi. Setelah aksi, `load()` refresh view; modal tetap terbuka.

## Testing (TDD, `src/test/vps-checklist.test.tsx`)

Render `<VpsChecklistModal vpsId onClose onToast>` dengan `api.vpsChecklist` di-mock.
1. **Default collapsed**: setelah muat, item seksi **tak** tampil; header seksi tampil dengan skor.
2. **Expand**: klik header seksi → `ItemRow`-nya muncul; klik lagi → tersembunyi.
3. **Header collapsed informatif**: header menampilkan hitungan `fail`/`warn` dan badge `drift` untuk seksi yang sesuai fixture.
4. **Search**: ketik kata kunci → hanya item cocok tampil dan seksi terkait auto-expand; kosongkan → collapse semua lagi.
5. **Filter existing** tetap bekerja (seksi/status) dan auto-expand.
6. **Aksi lewat modal**: N/A / attest / preview-remediasi masih memanggil API yang benar (expand seksi dulu bila perlu).
7. **VpsScreen**: tombol `Checklist` membuka modal; `onClose`/Esc menutup.

Perbarui test existing yang mengasumsikan item langsung terlihat → kini expand seksi dulu.

## Di luar scope

- Tak ada perubahan server/DTO/endpoint/katalog/scoring/skema.
- Tak menambah cara audit dipicu (tetap tombol Audit existing).
- Tak mengubah design system; ikut token & primitive `Modal`/`Button`/`Icon` yang ada (editorial, bone paper, brass accent).
- Persist state expand/collapse antar-buka (out of scope; selalu mulai collapsed).
