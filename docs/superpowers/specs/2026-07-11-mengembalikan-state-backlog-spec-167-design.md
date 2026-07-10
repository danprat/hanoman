# SPEC-167 — Mengembalikan State Backlog (backward-only)

## Objective
State backlog (`Spec.stage`) bisa dikembalikan sesuka hati human ke stage yang **lebih
awal**, tapi tak pernah maju atau loncat ke depan. Saat mundur, artefak docs yang
dihasilkan fase-fase di atas target dibersihkan — dengan konfirmasi UI yang menampilkan
daftar file lebih dulu.

Prioritas: tinggi. Constraint: **hanya backward**.

## Konteks
`Spec.stage` hari ini adalah cermin *monotonic-forward* dari fase yang dilaporkan agen
(ADR-0008, diperkuat ADR-0024). Lifecycle: `brainstorming → objective → spec-ready →
planned → executing → done` (`server/src/services/stage-machine.ts:2`).

Satu-satunya penulis stage adalah `advanceStage()` di `server/src/routes/terminal.ts:20-26`,
dipanggil saat `DELETE /terminal/sessions/:id` menutup sesi. Ia dijaga keras agar tak
pernah mundur:

```ts
if (!spec || STAGES.indexOf(next) <= STAGES.indexOf(spec.stage)) return; // terminal.ts:24
```

Route manual `POST /specs/:id/advance` yang lama sudah dicabut oleh ADR-0008 — sejak itu
tak ada jalur apa pun untuk mengubah stage secara manual, apalagi memundurkannya.
`PATCH /specs/:id` hanya menerima `branchFrom` (`shared/src/dto.ts:21`).

SPEC-167 menambah **pengecualian terkontrol yang dipicu human**: mundur ke stage lebih
awal mana pun, maju ditolak.

## Keputusan yang sudah diambil bersama user
1. **Cakupan:** mundur mengubah `Spec.stage` **dan** membersihkan artefak docs fase di atas
   target. Kode & commit Execute **tak pernah** dihapus otomatis.
2. **Konfirmasi UI:** kalau ada file yang akan dihapus, UI wajib menampilkan daftar file
   lebih dulu; hapus hanya setelah human menekan konfirmasi.
3. **Surface minimal:** perpanjang `PATCH /specs/:id` yang sudah ada — bukan endpoint baru.
   Logika pencocokan artefak hanya hidup di server (tak ada duplikasi client/server).

## Desain

### 1. Pemetaan fase → artefak
Satu-satunya pemetaan yang andal di codebase ini adalah konvensi penamaan superpowers docs
by spec-id (`Spec.id` `SPEC-167` → segmen `spec-167` di nama berkas, case-insensitive):

| Stage | Artefak (dihapus saat revert ke *bawah* stage ini) |
|---|---|
| `spec-ready` | `docs/superpowers/specs/*spec-167*.md` (design/brainstorm) |
| `planned` | `docs/superpowers/plans/*spec-167*.md` |
| `brainstorming`, `objective` | tak ada file (objective = kolom DB) |
| `executing`, `done` | kode/commit — **tak pernah dihapus** |

Pencocokan berbasis boundary: segmen `spec-167` harus diikuti non-digit atau akhir string,
supaya `spec-16` tidak menyerempet `spec-167`. Proyek tanpa dir superpowers → glob kosong →
no-op yang aman.

**Aturan:** revert dari `current` → `target` menghapus artefak setiap stage `S` di mana
`STAGES.indexOf(target) < STAGES.indexOf(S) ≤ STAGES.indexOf(current)`. Contoh:
- `done → objective`: hapus docs plan **dan** spec.
- `done → spec-ready`: hapus docs plan saja.
- `done → planned`: **tak ada** file (planned & execute tak punya artefak berkas).

### 2. Server — `PATCH /specs/:id`
Body diperluas jadi `{ branchFrom?, stage?, confirmDelete? }` (semua opsional; jalur
`branchFrom` tak berubah). Saat `stage` dikirim:

1. Kalau `STAGES.indexOf(target) >= STAGES.indexOf(current)` → **422** (maju/sama ditolak;
   ini cermin terbalik dari guard forward-only di `terminal.ts:24`). `422` dipilih senada
   SPEC-166 (body valid, operasi tak boleh) — beda dari `400` untuk body cacat / nilai
   stage tak dikenal (dijaga `zStage`).
2. Hitung `wouldDelete` = daftar artefak menurut aturan §1.
3. **Dry-run:** kalau `wouldDelete` tak kosong **dan** `confirmDelete` bukan `true` → **tak
   mengubah apa pun**, balas `200 { pending: true, stage: target, wouldDelete: string[] }`.
4. **Eksekusi:** kalau `wouldDelete` kosong, **atau** `confirmDelete === true` → update
   `Spec.stage = target`, hapus tiap berkas `wouldDelete` (best-effort, reuse
   `deleteDoc(projectId, path)` — guard `.md` + dalam-repo sudah ada), balas Spec terbaru.

Atomisitas praktis: dry-run tak menyentuh apa pun; stage baru berubah pada panggilan
eksekusi, berbarengan dengan penghapusan. Batal di UI = tak ada mutasi sama sekali.

### 3. Frontend — `SpecDetail` modal
Di `src/src/screens/BacklogScreen.tsx`, di sebelah `StageBar` (modal detail, bukan board —
board sengaja melarang drag karena stage mengikuti fase agen; revert harus aksi eksplisit):

- Dropdown "Kembalikan stage ke…" berisi **hanya** stage yang lebih awal dari `spec.stage`.
- On pilih target → `api.patchSpec(id, { stage })`.
  - Respons `Spec` (tak ada yang dihapus) → tutup, refresh.
  - Respons `{ pending: true, wouldDelete }` → buka dialog konfirmasi yang menampilkan daftar
    `wouldDelete`. Batal → tak terjadi apa-apa. Konfirmasi → `api.patchSpec(id, { stage,
    confirmDelete: true })`, lalu refresh.
- Item `done` tetap boleh direvert (bukan lagi terminal untuk human).

### 4. DTO / API client
- `shared/src/dto.ts`: `zPatchSpec` → `{ branchFrom?: string|null, stage?: Stage,
  confirmDelete?: boolean }` (branchFrom jadi opsional).
- `src/src/api/client.ts`: `patchSpec(id, body)` menerima bentuk baru; tipe respons union
  `Spec | { pending: true; stage: string; wouldDelete: string[] }`.

### 5. Non-goals
- Tak ada endpoint/route baru (`POST /revert` dll).
- Tak ada `prevStage()` helper — index math cukup.
- Tak ada tabel audit / histori revert.
- Tak menghapus kode, commit, atau branch. Tak menyentuh worktree/sesi tmux yang hidup
  (kalau sesi lama ditutup setelah revert, guard forward-only `terminal.ts:24` wajar
  memajukan stage lagi — itu perilaku yang diterima).
- Tak menghapus docs di luar dua dir superpowers ber-spec-id.

## Error handling (rangkuman)
- Spec tak ada → `404` (seperti sekarang).
- Body cacat / `stage` bukan nilai `zStage` → `400`.
- `stage` maju atau sama dengan current → `422`.
- `deleteDoc` gagal untuk suatu berkas → best-effort; stage tetap berubah, berkas yang
  gagal dilewati (tak menyandera revert). Tak ada berkas cocok → no-op mulus.

## Testing
- **Server** (`server/test/specs.*.test.ts`):
  - revert mundur satu langkah tanpa artefak → `200`, stage berubah.
  - revert maju / ke stage sama → `422`, stage tak berubah.
  - `stage` tak dikenal → `400`.
  - dry-run: ada artefak + tanpa `confirmDelete` → `200 { pending, wouldDelete }`, file &
    stage utuh.
  - eksekusi: `confirmDelete: true` → stage berubah + file terhapus dari disk.
  - boundary spec-id: `spec-16` tak menghapus artefak `spec-167`.
  - `branchFrom` lama tetap jalan (regresi).
- **Frontend** (`src/test/backlog-board.test.tsx` atau baru): dropdown hanya menampilkan
  stage lebih awal; alur dry-run → dialog → confirm memanggil `patchSpec` dua kali dengan
  `confirmDelete`.

## Dokumentasi (commit yang sama saat implementasi)
- `internal/docs/architecture/data-model.md` — catat stage kini boleh mundur atas perintah
  human eksplisit (bukan lagi murni monotonic-forward).
- `internal/docs/architecture/api-contract.md` — perbarui blok `PATCH /specs/:id` (body
  `stage`/`confirmDelete`, 422, dry-run `wouldDelete`).
- **ADR baru** (nomor diverifikasi lintas branch saat implementasi — kandidat 0027) yang
  mengamandemen invariant forward-only ADR-0008/0024: stage mundur diizinkan **hanya** lewat
  aksi human eksplisit; agen tetap forward-only.
