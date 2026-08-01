# SPEC-490 — Setiap field form di dashboard wajib punya placeholder

**Tanggal:** 2026-08-01 · **Sumber:** brief · **Prioritas:** rendah
**Tanpa ADR · tanpa perubahan skema · tanpa endpoint baru · tanpa perubahan validasi.**

## Masalah

Banyak field form di dashboard kosong tanpa placeholder, jadi operator harus menebak bentuk
nilai yang diharapkan — terutama field berformat khusus (path, URL, token, chat id, cron,
angka berdimensi waktu). Sebagian field yang *punya* placeholder pun tak menolong: isinya
mengulang label ("Cari backlog" → `Cari backlog…`) atau memberi instruksi
("Ceritakan apa yang terjadi…") alih-alih **contoh nilai nyata**.

## Enumerasi (bukti, bukan tebakan)

Scanner JSX (`scan.mjs`, komentar dan isi string di-blank dulu supaya `<input>` di dalam
prosa komentar tak ikut terhitung — 5 positif palsu terbuang) atas `src/src/**/*.tsx`
non-test:

| kelompok | jumlah |
|---|---|
| seluruh elemen form (`Input`/`HnTextarea`/`textarea`/`input`/`Select`/`MultiSelect`) | 156 |
| **dalam scope** (teks · textarea · combobox/search) | **80** |
| dalam scope **tanpa placeholder** | **24** |
| di luar scope (`Select` 65, checkbox/radio/file/date 11) | 76 |

24 yang kosong tersebar di 11 berkas: `App.tsx` (3), `BacklogScreen` (2),
`CustomAgentsPanel` (3), `DocsWorkspace` (1), `IdeScreen` (1), `LeadScreen` (3),
`SchedulerScreen` (2), `SettingsScreen` (4), `TerminalScreen` (1), `TriageScreen` (2),
`VpsScreen` (1), `PublicHelpApp` (1 — honeypot).

## Batas scope, dan alasannya

**Masuk:** input teks (termasuk `type="password"`/`"number"`/`"email"`/`"search"`),
`textarea`/`HnTextarea`, dan kolom cari di combobox (`MultiSelect.searchPlaceholder`).

**Keluar, dengan alasan:**

- **`<Select>` native (65 call site)** — dropdown selalu menampilkan opsi yang sedang
  terpilih, jadi tak pernah ada keadaan "kotak kosong tanpa petunjuk". Keadaan
  *belum-memilih* sudah dilayani opsi pertama yang eksplisit (`Pilih branch…`,
  `Pilih stage lebih awal…`, `main (default project)`) di semua Select yang memang bisa
  kosong — diverifikasi satu per satu. Objective SPEC-490 pun menyebut "input teks,
  textarea, dan kombobox/search".
- **`type="date"`** (3) — Chrome/Safari/Firefox **mengabaikan** `placeholder` pada input
  tanggal; yang dirender adalah widget tanggal bawaan. Placeholder di sana adalah atribut
  mati, bukan perbaikan.
- **checkbox · radio · file** (8) — tak punya kolom teks.
- **honeypot `hc_trap`** (`PublicHelpApp.tsx`) — sengaja tak terlihat manusia
  (SPEC-352); placeholder justru memberi petunjuk ke bot pengisi.
- **editor isi berkas IDE** (`IdeScreen.tsx`) — isinya berkas apa pun bahasa apa pun;
  tak ada satu contoh yang benar lintas `.ts`/`.json`/`.sh`.

Tiga yang terakhir tidak dilewati diam-diam — lihat "Pintu darurat" di bawah.

## Aturan placeholder (yang masuk docs design-system)

1. Placeholder berisi **contoh nilai nyata**, diawali `mis. ` bila nilainya bebas
   (`mis. erp-tumbuh-ai`), atau **bentuk formatnya apa adanya** bila formatnya terikat
   (`~/.ssh/id_ed25519`, `https://github.com/org/repo.git`, `-1001234567890`).
2. Placeholder **bukan pengulangan label** dan **bukan instruksi**. Label menjawab
   *"ini field apa"*; hint (`Field.hint`) menjawab *"aturannya apa"*; placeholder
   menjawab *"isinya kelihatan seperti apa"*. Tiga pekerjaan berbeda.
3. Placeholder **tidak menggantikan label** — label tetap wajib (`Field label=…` atau
   `aria-label`). Placeholder hilang begitu diketik; label tidak.
4. Field yang nilainya sudah ada boleh memakai placeholder sebagai **penanda keadaan**
   (`••••1234`, `biarkan kosong = pertahankan`) — itu lebih berguna daripada contoh saat
   nilainya memang sudah terisi.

## Arsitektur — tiga lapis, karena ini pola "satu definisi, N call site"

### Lapis 1 — katalog (satu definisi menutup banyak field terender)

Sebagian field tidak ditulis satu-satu di JSX; ia dirender dari data. Menambal
call site-nya berarti menambal **satu** `<Input>` yang melayani puluhan field:

| permukaan | dirender dari | jumlah field terender |
|---|---|---|
| Settings → Config (`ConfigField`) | `CONFIG_REGISTRY` (`@hanoman/shared`) | ~25 field editable |
| Settings → Kredensial Telegram | `tgCreds.fields` — **key yang sama** dari registry itu | 4 |
| Backlog → detail spec, mode edit | `BRIEF_FIELDS`/`GOAL_FIELDS`/`QA_FIELDS` | 3 · 3 · 5 |

Karena itu contohnya hidup **di katalognya**:

- `ConfigEntry` (`shared/src/config-registry.ts`) dapat field baru `example?: string`,
  diisi untuk tiap entri editable. `ConfigField` merender
  `placeholder={configEntry(entry.key)?.example}`.
- Panel Telegram memakai lookup yang **sama** (`configEntry(f.key)?.example`) — kunci
  `HANOMAN_TELEGRAM_*` memang entri registry, jadi satu isian melayani dua panel.
- `BRIEF_FIELDS`/`GOAL_FIELDS`/`QA_FIELDS` jadi triple `[key, label, placeholder]`.

**Kenapa lewat `@hanoman/shared`, bukan diperlebar ke `ConfigEntryView` (respons API):**
placeholder adalah urusan presentasi, dan katalognya sudah ikut ter-bundle ke web
(`src` sudah `import { configEntry } from "@hanoman/shared"`-able). Menaruhnya di wire
contract berarti mengubah `GET /api/config`, `internal/docs/architecture/api-contract.md`,
dan test kontraknya untuk nilai yang **bisa dihitung ulang klien dari sumber yang sama** —
persis pertanyaan ADR-0018. Nol perubahan server.

### Lapis 2 — call site

Dari 24 field kosong: **2** ditutup lapis 1 (`ConfigField`, detail spec mode edit),
**2** masuk pintu darurat (honeypot, editor berkas IDE), sisa **20** ditambal langsung
di JSX-nya. Ditambah **≈25 placeholder yang sudah ada tapi mengulang label
atau berisi instruksi** — `Cari backlog…` untuk label "Cari backlog",
`Situasi & motivasi…`, `Ceritakan apa yang terjadi…`, `nama`, `url` — yang ditulis
ulang jadi contoh.

### Lapis 3 — kontrak yang mencegah kambuh

`src/test/placeholder-contract.test.ts` men-scan `src/src/**/*.tsx` (non-test) dengan
scanner yang sama dan menuntut, untuk setiap field dalam scope:

1. ada `placeholder` yang **tidak kosong** — untuk `MultiSelect` yang dituntut adalah
   **`searchPlaceholder`**, karena `placeholder`-nya adalah label tombol
   (`Pilih tools…`), bukan petunjuk kolom cari;
2. bila placeholder **dan** namanya sama-sama literal statis, keduanya **tidak sama**
   (dinormalkan: trim, lowercase, buang `…`/`:`/`mis. `). Nama diambil dari `aria-label`
   elemen itu, atau dari `<Field label="…">` terdekat yang mendahuluinya di berkas yang
   sama.

Ini komponen yang mahal untuk dilewatkan tanpa kontrak: bugnya **tak terlihat** —
field tanpa placeholder terlihat persis seperti field yang belum diketik. Repo sudah
tiga kali membayar kelas "satu definisi, N call site" (SPEC-431/448/475/481), dan
penangkalnya di sini murah: test sumber, seperti `server/test/webhook-no-raw-writes.test.ts`
dan `src/test/scroll-chain.test.tsx`.

Scanner-nya **satu definisi juga**: `src/test/helpers/form-fields.ts` mengekspor
`scanFormFields(root)`, dipakai test — bukan dua parser yang bisa berselisih.

### Pintu darurat

Field yang sah tak punya placeholder ditandai komentar tepat sebelum tag-nya:

```tsx
{/* placeholder-exempt: honeypot — sengaja tak terlihat manusia (SPEC-352) */}
<input aria-hidden … />
```

Scanner menerima `placeholder-exempt: <alasan>` (alasan wajib non-kosong) dan
mengeluarkannya dari daftar wajib. Bukan `data-*` di DOM: ini aturan penulisan kode,
bukan atribut runtime. Tiga pemakai: honeypot Help Center, editor berkas IDE, dan —
bila kelak ada — field bertipe di luar teks yang lolos filter tipe.

## Isi placeholder

Contoh dipilih dari data nyata repo/dokumen supaya bentuknya benar, bukan karangan:

| field | placeholder |
|---|---|
| ID project | `mis. erp-tumbuh-ai` |
| Nama project | `mis. ERP Tumbuh AI` |
| Deskripsi project | `mis. ERP manufaktur + inventori` |
| Port SSH | `22` |
| Nama grup terminal | `mis. Rilis` |
| Nama custom agent | `mis. peninjau-keamanan` |
| Deskripsi custom agent | `mis. Dipakai saat meninjau perubahan yang menyentuh auth` |
| Instruksi custom agent | `mis. Kamu peninjau keamanan. Baca diff, laporkan …` |
| Cari (backlog/sesi/project/tool/issue) | `mis. invoice atau SPEC-412` (disesuaikan) |
| Batas waktu putusan lead (detik) | `600` |
| Denyut lead (menit) | `5` |
| Chat id Telegram | `-1001234567890` |
| Bot token Telegram | `123456789:AAE…` |
| Password | `••••••••` (bentuk, bukan contoh — nilainya rahasia) |

Semua Bahasa Indonesia, mengikuti bahasa UI yang sudah ada.

## Testing

- **Kontrak** — `src/test/placeholder-contract.test.ts` (lapis 3 di atas). Menghitung
  jumlah field yang dipindai dan **gagal bila nol** — jebakan `passWithNoTests`
  (`--changed`) dan scanner yang diam-diam berhenti cocok punya gejala yang sama.
- **Katalog** — test bahwa setiap `ConfigEntry` `editable` (bukan `bootstrap`, bukan
  `bool`) punya `example`; ini yang menjaga entri config **baru** ikut terisi.
- **Regresi UI** — test render yang ada (`settings-*.test.tsx`, `custom-agents-panel`,
  `backlog-*`) tetap hijau; tak ada perilaku yang berubah, hanya atribut.

## Yang **tidak** berubah

Validasi, submit, endpoint, skema, label, `Field.hint`, dan komponen design system
(`Input`/`HnTextarea`/`Select`/`MultiSelect` sudah meneruskan `placeholder` — tak ada
prop baru yang perlu ditambahkan).

## Docs yang tersentuh

- `internal/docs/design-system/design-system.md` — bagian baru "Placeholder: contoh
  nilai, bukan pengulangan label" (aturan 1–4 + pintu darurat).
- `internal/docs/frontend/frontend-implementation.md` — di mana aturan itu ditegakkan
  (katalog + test kontrak), dan daftar apa yang di luar scope berikut alasannya.
- `internal/docs/README.md` — keduanya sudah ter-link; tak ada entri baru.
