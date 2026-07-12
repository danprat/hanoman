# SPEC-198 · Search, Filter, Pagination via API — Design

**Backlog item:** SPEC-198 (brief, prioritas tinggi)
**Objective:** Search, filter, dan pagination dilakukan via API — bukan lagi di frontend. Hati-hati ada fitur tersembunyi yang tersenggol selama mengerjakan pagination.

## Masalah

Saat ini semua search/filter/pagination 100% client-side. `App.tsx` menarik seluruh dataset sekali (`listProjects`, `listSpecs`, `listTerminals`), menyimpannya di state, dan setiap penyaringan/paginasi/hitungan diturunkan dari array penuh itu di browser. Server hampir tak punya penyempit daftar (`GET /specs` cuma menerima `project` & `source`, dan itupun tak dipakai klien).

Surface client-side yang ada:
- **Backlog** (`BacklogScreen`): search + tab(source) + project + stage + priority + paginasi (`usePaged`/`Pager`), lintas view grid/list/board.
- **Terminal picker** (`BacklogPicker` di `TerminalScreen`): salinan kedua dari filter search/stage/priority atas `startable`.
- **Projects** (`ProjectsScreen` + App): search di topbar (`shownProjects`) + paginasi `usePaged`.

## Fitur tersembunyi yang wajib dijaga

`GET /specs` **bukan** list polos. Ia:
1. Memuat **seluruh** spec (scope `project`/`source`).
2. Meng-overlay **stage live** dari phase-file sesi (`sessionPhasesBySpec` + `stageForRun`).
3. **Write-through** memajukan stage di DB (CAS, forward-only — SPEC-197).
4. Menembakkan **notifikasi `done`** (`recordCompletion`, idempoten).

Array penuh yang sama memberi makan: hitungan Overview, picker Terminal, kolom Board, dan **poll 3 detik** (`App.tsx`) yang membanding `[id,stage]` lintas **seluruh** spec untuk menjaga board tetap jujur (SPEC-197).

**Jebakan:** kalau `WHERE stage=` / `skip`/`take` didorong ke query DB, maka (a) filter `stage` mencocokkan stage DB yang **basi**, bukan stage live hasil overlay, dan (b) overlay + write-through + notifikasi hanya jalan atas **satu halaman** → **spec di luar halaman diam-diam berhenti maju stage-nya dan berhenti menembakkan notifikasi `done`**. Inilah yang "tersenggol".

**Prinsip pengaman:** overlay + write-through + notifikasi **selalu** jalan atas set penuh (scope project/source). Search/filter/paginasi diterapkan di **layer response**, *setelah* overlay — tak pernah menciutkan set yang di-overlay, dan filter `stage`/`startable` mencocokkan stage **live**.

## Keputusan (dikonfirmasi user)

- **Scope:** ketiga surface — Backlog (grid/list/board) + Terminal picker + Projects.
- **Kontrak:** **selalu** envelope `{ items, total, page, pageSize }` (bukan opt-in).

## Kontrak API

```
GET /specs?project=&source=&q=&stage=&priority=&startable=&page=&limit=
   -> { items: Spec[], total, page, pageSize }
```
- DB `where` = `{ projectId: project, source }` saja (field stabil, aman sebelum overlay).
- Overlay + write-through + notifikasi jalan atas set penuh scope project/source — **tak berubah**.
- Lalu di memori: filter `q` (case-insensitive atas `id + title + objective`), `stage` (cocokkan stage **live**), `priority`, `startable` (stage live ≠ `done`). `total` = jumlah setelah filter; potong `page`/`limit`.
- Tanpa `page`/`limit` → seluruh item terfilter, `page=1`, `pageSize=total`. (Dipakai full-fetch App, poll, board.)
- `orderBy: id desc` dipertahankan.

```
GET /projects?q=&page=&limit=
   -> { items: ProjectView[], total, page, pageSize }
```
- project-view dihitung seperti sekarang (coverage/docStatus live per project); lalu filter `q` (atas `name + desc + stack`) + paginasi di memori.
- Tanpa `page`/`limit` → seluruh item. (Dipakai full-fetch App untuk Overview + StatStrip.)

Endpoint lain (`/terminal/sessions`, `/vps`, `/auth/users`, `/notifications`) **tak** disentuh — di luar scope.

## Shared

- `shared/src/dto.ts`: `Paginated<T> = { items: T[]; total: number; page: number; pageSize: number }`.
- `api.listSpecs(params?)` & `api.listProjects(params?)`: bangun query-string dari objek param, return `Paginated<...>`.

## Frontend

**App** (churn minimal — hanya buka bungkus):
- `load()`/poll baca `.items` dari envelope → `backlog`/`projects` tetap set penuh. Overview, Board, `backlog.find` (review/integrate/titleOf), StatStrip, poll signature **tak berubah** (full-fetch tak berparam → set penuh).

**BacklogScreen** (jadi self-fetching):
- Punya state filter + `page` sendiri. Fetch `listSpecs({project, source, q, stage, priority, page, limit})` untuk grid/list; board fetch **tanpa** `page`/`limit` (set terfilter penuh). Render `items`; `Pager` dari `total`.
- Self-poll query aktif tiap 3 dtk selama ada sesi hidup (pakai ulang guard-signature SPEC-197). Karena overlay jalan server-side atas set penuh, spec di luar halaman tetap maju & bernotifikasi — poll klien cukup menyegarkan yang sedang tampil.
- Detail modal resolve dari `items` yang di-fetch; refetch setelah mutasi (start/edit/revert/delete).
- `search` di-debounce (~250 ms) agar tiap ketikan tak membanjiri fetch.

**ProjectsScreen**:
- Fetch `listProjects({q, page, limit})` untuk baris; `Pager` dari `total`. `q` diisi dari `search` topbar App (diteruskan sebagai prop).
- **StatStrip** dihitung dari `projects` penuh milik App (sudah di-fetch untuk Overview) → statistik tetap global & benar. Perubahan perilaku kecil-dan-lebih-benar: StatStrip = ringkasan global, search hanya menyaring baris. `shownProjects` client-filter di App dihapus.

**Terminal picker**:
- Fetch `listSpecs({startable:true, q, stage, priority})` saat buka + saat filter berubah → `items`. Exclusi spec yang sesinya sedang aktif tetap di klien (itu state sesi, bukan filter/paginasi).

**Primitif**:
- `Pager` dipakai ulang apa adanya (render dari page/pageCount/total/from/to).
- `usePaged` (client-slice) jadi mati setelah migrasi kedua pemakainya → **hapus**. Ganti dengan helper murni `serverPage(total, page, pageSize) -> { page, pageCount, from, to }` untuk memberi makan `Pager`.

## ADR

**ADR-0038** (verifikasi nomor lintas branch sebelum menulis — sibling worktree bisa tabrakan): "Paginasi/filter di layer response, overlay atas set penuh." Mencatat *kenapa* `/specs` memuat-semua-lalu-memotong, bukan `skip`/`take` DB — supaya tak ada yang "meng-optimasi" jadi DB-level dan mematikan overlay/notifikasi off-page. Tak ada perubahan skema → tak ada migration.

## Testing

Server (vitest, DB `hanoman_test`):
- Bentuk envelope `{ items, total, page, pageSize }` untuk `/specs` & `/projects`.
- Filter `q`/`stage`/`priority`/`startable`; paginasi (`total` benar, potongan `page`, page di luar rentang).
- **Guard fitur tersembunyi:** dengan `page`/`limit` sempit, spec di halaman lain yang stage live-nya maju **tetap** ter-write-through + bernotifikasi (overlay atas set penuh). Filter `stage` mencocokkan stage **live**, bukan DB.
- `/projects`: filter `q` + paginasi.

Frontend: test yang ada disesuaikan ke bentuk envelope.

Real API (per CLAUDE.md — boot server + curl):
- `GET /specs?page=1&limit=5`, `GET /specs?q=...&stage=executing`, `GET /specs?startable=true`, `GET /projects?q=...&page=1&limit=2`.

## Non-goals / ceiling

- Tanpa `skip`/`take` DB untuk specs — overlay menuntut muat-penuh; backlog terbatas (ratusan) jadi potong-di-memori memadai. `ponytail:` ceiling — kalau jumlah spec meledak, revisit dengan materialisasi stage.
- Endpoint list lain di luar scope.
