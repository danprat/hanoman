# Path project optional, per-client, editable (SPEC-217) — Design

Sumber: qa · prioritas tinggi · 2026-07-15
Doc-of-record audit: `internal/docs/research/audit-spec-217-path-project-optional.md`
Metode audit: `superpowers:systematic-debugging`.

## Masalah
SPEC-213 (ADR-0043) sudah menaruh path project sebagai **per-mesin & tak disync** lewat
`LocalBinding` + `resolveRepoDir` (binding menang atas `Project.repoDir`, null-safe). Tapi mekanisme
itu **hanya tersambung di spawn (terminal) & IDE**. Sisa aplikasi membaca `Project.repoDir` langsung,
tak ada UI untuk mengedit binding, `Project.repoDir` tak bisa di-PATCH, dan create form memaksa path.
Akibatnya path per-client **tak berfungsi end-to-end**, tak **optional** di UI, dan tak **editable**.

## Tujuan
Menuntaskan tuntutan SPEC-217 di atas fondasi SPEC-213 yang sudah ada — **tanpa perubahan skema**
(schema sudah `nullable` + `LocalBinding` ada), **tanpa migration/ADR baru**.

## Desain (ditetapkan ADR-0043; tak ada percabangan baru)
Path efektif = `resolveRepoDir(projectId)` = **binding lokal ?? `Project.repoDir`**.
- **`Project.repoDir`** = path "default/server" (opsional, boleh di-set oleh siapa pun yang membuat
  project di host itu; dikecualikan dari sync). Kini **editable** via `PATCH /projects/:id`.
- **`LocalBinding.repoDir`** = path **per-mesin** (tak pernah disync), editable via `PUT
  /projects/:id/binding`. Inilah affordance "edit path per-client" di UI.
- **Semua jalur baca** repoDir dialihkan ke `resolveRepoDir` agar binding benar-benar berlaku
  di coverage, branches, specs (buat/review/integrate), docs, PRD, spec-docs, stage-artifacts.
- `ProjectView` memuat **path efektif** (`repoDir` = resolved) + `binding` (nilai binding mentah,
  `null` bila tak ada) supaya UI bisa membedakan "pakai default" vs "override per-mesin".

Non-goal: mengubah skema, menyinkronkan path, menyentuh flow sync engine, mengubah IDE/terminal
yang sudah benar (sudah `resolveRepoDir`).

## Acceptance criteria (EARS)
- **AC-1 (Optional, API):** THE SYSTEM SHALL menerima `POST /projects` tanpa `repoDir` → 201 dengan
  `repoDir:null`. *(sudah lulus SPEC-213; jaga regresi.)*
- **AC-2 (Optional, UI):** WHERE project kind `existing`, THE SYSTEM SHALL mengizinkan submit create
  meski field path kosong (path tak lagi wajib).
- **AC-3 (Editable — binding per-client):** WHEN user menyimpan path baru di UI project, THE SYSTEM
  SHALL menulisnya ke `LocalBinding` via `PUT /projects/:id/binding` dan **tak** menyinkronkannya.
- **AC-4 (Editable — default/server):** WHEN `PATCH /projects/:id` menyertakan `repoDir`, THE SYSTEM
  SHALL memperbarui `Project.repoDir` (termasuk mengosongkan ke `null` bila diminta).
- **AC-5 (Hapus binding):** WHEN user mengosongkan override per-client, THE SYSTEM SHALL menghapus
  `LocalBinding` project itu sehingga path efektif jatuh kembali ke `Project.repoDir`.
- **AC-6 (Binding berlaku end-to-end):** WHILE sebuah `LocalBinding` ada untuk project, THE SYSTEM
  SHALL memakai path binding pada coverage/docStatus, dropdown branch, buat spec, review, integrate,
  docs, PRD, spec-docs, dan stage-artifacts (bukan `Project.repoDir` mentah).
- **AC-7 (Tak ada path → 4xx bersih, bukan 500):** IF path efektif `null`, THEN THE SYSTEM SHALL
  membalas 4xx bermakna (mis. 409 "belum di-bind ke checkout lokal") atau daftar kosong, tak pernah
  melempar 500. *(jaga null-safety yang sudah ada.)*
- **AC-8 (Path efektif tampil):** THE SYSTEM SHALL menampilkan path efektif (resolved) dan status
  override (binding aktif / pakai default) di `ProjectView` dan detail project.
- **AC-9 (Tak ada sync path):** THE SYSTEM SHALL tetap mengecualikan `Project.repoDir` & `LocalBinding`
  dari sync. *(jaga regresi SPEC-213.)*

## Risiko & mitigasi
- **Perubahan signature async** di service docs/prd/spec-docs (dari baca `project.repoDir` sinkron ke
  `await resolveRepoDir`) → sudah async semua; alihkan pemanggilan internal ke helper binding-aware.
- **Parity test lama** (terminal/ide/specs) → jalankan penuh tiap task, jaga kode status.
- **Shell sesi menunjuk prod** (memori) → test pakai `env -u NODE_ENV -u DATABASE_URL`.
