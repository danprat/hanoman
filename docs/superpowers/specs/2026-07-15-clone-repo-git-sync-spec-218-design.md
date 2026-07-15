# Clone existing codebase dari GitHub/GitLab + daftar git remote saat edit (SPEC-218) — Design

Sumber: user · prioritas normal · 2026-07-15
Fondasi: SPEC-213 (ADR-0043, `gitRemote` + `POST /projects/:id/clone` + `LocalBinding`), SPEC-217 (path optional/editable).

## Masalah
Backend **sudah** mendukung clone: `Project.gitRemote` (remote resmi, disync), `POST /projects/:id/clone`
(`git clone <gitRemote> <dir>` lalu set `LocalBinding`), dan `resolveRepoDir` (binding per-mesin ?? repoDir).
Tapi **UI React tak pernah mengeksposnya**:
1. Form create "Existing codebase" hanya meminta **direktori lokal** — tak ada cara menambah project dengan
   **clone dari URL GitHub/GitLab**.
2. Form edit project hanya mengubah nama, deskripsi, dan path per-mesin — **tak ada field `gitRemote`**,
   jadi tak ada cara mendaftarkan remote agar **device lain** bisa mendapatkan kode via `git clone`.

Akibatnya "sync antar-device via git" tak berfungsi dari UI: device baru tak punya jalan self-service untuk
mendaftar/meng-clone kode project.

## Tujuan
Menyambungkan UI ke flow clone/gitRemote yang **sudah ada** — **tanpa perubahan skema, migration, ADR, atau
endpoint backend baru**. Makna "sync": **clone sekali** untuk mendapatkan checkout kode di device baru (update
kode berikutnya manual via `git pull` di terminal); **bukan** auto-sync pull/push berkala (fitur terpisah).

## Desain (frontend-only; merangkai endpoint yang ada)
Seluruh perubahan di `src/src/App.tsx` + `src/src/api/client.ts` + `src/src/screens/ProjectDetailScreen.tsx`.

### Alur create-by-clone (tab Existing → mode "Clone dari URL git")
1. `POST /projects { name, kind:"existing", gitRemote:<url> }` — **tanpa** `repoDir`.
2. `POST /projects/:id/clone { dir:<tujuan> }` — `git clone` + set `LocalBinding` (jalur backend yang ada).
3. `getProject(id)` → buka Docs (reverse-engineer).

`name` diturunkan dari basename URL bila user tak mengisi nama (`…/repo.git` → `repo`).

### Alur edit-tambah-remote
- Field baru **"Git remote"** di `EditProjectModal` → `PATCH /projects/:id { name, desc, gitRemote }`.
- Path per-mesin tetap lewat `putBinding`/`deleteBinding` seperti sekarang (SPEC-217).
- Karena `gitRemote` ada di daftar sync (SPEC-213, `sync.ts`), remote tersebar ke device lain; device lain
  lalu memakai alur clone yang sama untuk mendapatkan kode.

### UI — NewProjectModal
Tab "Existing codebase" mendapat **sub-toggle** (komponen `Tabs` variant pill yang sudah ada) dua mode:
- **Dari folder lokal** (default; perilaku sekarang): field Direktori + "Pilih folder" → `repoDir`.
- **Clone dari URL git** (baru): field **URL repository** (`gitRemote`) + field **Folder tujuan** (`dir`,
  dengan `FolderPicker`) + Deskripsi. `canSubmit` = URL **dan** folder tujuan terisi. Label tombol
  "Clone → reverse-engineer docs".

`ProjectForm` bertambah `mode: "local" | "clone"` dan `gitRemote: string`.

### UI — EditProjectModal + ProjectDetailScreen
- `EditProjectModal`: tambah field **"Git remote"** (mono, placeholder URL git, hint "opsional · remote resmi
  agar device lain bisa clone · disync antar-device"), terisi dari `project.gitRemote`.
- `ProjectDetailScreen`: tampilkan `gitRemote` di grid Meta (label "Git remote", `—` bila kosong) supaya
  status "punya remote untuk di-clone device lain" terlihat.

Non-goal: auto-sync pull/push, input kredensial/SSH-key/token, endpoint create+clone atomik, perubahan skema,
timeout async untuk `git clone`.

## Acceptance criteria (EARS)
- **AC-1 (Create by clone):** WHEN user memilih mode "Clone dari URL git", mengisi URL + folder tujuan, dan
  submit, THE SYSTEM SHALL `POST /projects` (kind `existing`, `gitRemote` terisi, tanpa `repoDir`) lalu
  `POST /projects/:id/clone` dengan `dir` tujuan.
- **AC-2 (Create by clone — bind):** WHEN clone sukses, THE SYSTEM SHALL menyetel `LocalBinding` project ke
  folder tujuan sehingga `resolveRepoDir` mengembalikan checkout hasil clone. *(perilaku endpoint yang ada.)*
- **AC-3 (Nama dari URL):** IF user tak mengisi nama pada mode clone, THEN THE SYSTEM SHALL menurunkan nama
  dari basename URL git (mis. `git@gitlab.com:org/repo.git` → `repo`).
- **AC-4 (Mode lokal tak berubah):** WHEN user memilih "Dari folder lokal", THE SYSTEM SHALL berperilaku
  seperti sekarang (`repoDir` = path, tanpa memanggil clone) — jaga regresi SPEC-217.
- **AC-5 (Edit — set git remote):** WHEN user menyimpan project dengan field "Git remote" terisi, THE SYSTEM
  SHALL `PATCH /projects/:id` menyertakan `gitRemote`.
- **AC-6 (Edit — hapus git remote):** WHEN user mengosongkan field "Git remote", THE SYSTEM SHALL mengirim
  perubahan yang mengosongkan `Project.gitRemote`.
- **AC-7 (Remote terlihat):** THE SYSTEM SHALL menampilkan `gitRemote` project di detail project (`—` bila
  belum diset).
- **AC-8 (Clone gagal → tak yatim, tak 500 di UI):** IF `POST /clone` membalas 4xx (auth/URL salah/dir sudah
  ada), THEN THE SYSTEM SHALL menampilkan toast error dengan detail dan **membiarkan project tetap ada**
  (dengan `gitRemote`) agar bisa di-clone ulang; UI tak crash.
- **AC-9 (Submit gating):** WHILE mode clone dan URL atau folder tujuan kosong, THE SYSTEM SHALL menonaktifkan
  submit. WHILE clone berjalan, THE SYSTEM SHALL menampilkan state loading dan menonaktifkan submit.

## Risiko & mitigasi
- **Repo privat** → `git clone` mengandalkan kredensial git host (SSH agent / credential helper). Gagal =
  4xx + `stderr` ditampilkan; input token/SSH-key adalah fitur terpisah (out of scope).
- **Clone lambat / hang** (`spawnSync` tanpa timeout) → tampilkan loading; timeout async out of scope, catat
  sebagai follow-up.
- **`zUpdateProject` menerima `gitRemote:""`?** → verifikasi saat implementasi; bila string kosong tak
  mengosongkan kolom, kirim lewat jalur yang mengizinkan null. (Cek `shared/src/dto.ts`.)
- **Partial state** (project terbuat, clone gagal) → disengaja & benar: remote tersimpan, tinggal retry clone
  dari device ini; tak ada baris yatim/duplikat.
- **Shell sesi menunjuk prod** (memori) → test pakai `env -u NODE_ENV -u DATABASE_URL`.
