# Audit SPEC-383 — Setting model sesi: blok claude/codex tak terbedakan & konflik tak punya default sendiri

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major · **Tanggal:** 2026-07-29
**Metode:** `superpowers:systematic-debugging`

## Keluhan

> "saat ini model sesi di setting ui nya kurang baik"
> Ekspektasi: "setting model sesi codex & claude dapat dengan mudah di kenali serta pemilihan
> setting model sesi untuk yang conflict rebase & merge bisa di setting defaultnya di setting"

Dua temuan terpisah dengan akar berbeda: **A** murni UI (recognizability), **B** memang fitur yang
belum ada (knob default untuk sesi penyelesai konflik).

---

## Temuan A — blok claude tak pernah menyebut "claude", dan "default global" bisa berbohong

### Bukti terukur

Render `SettingsScreen` tab **Model sesi** dengan `Setting = { agent: "codex", codex: { model:
"gpt-5.6-terra", effort: "high" } }` (jsdom, `@testing-library/react`). Teks yang benar-benar
terlihat operator:

```
agen · Agen sesi
  Agen default            → [Claude Code | Codex CLI]     (terpilih: Codex CLI)
  Model codex             → [GPT-5.6 Sol … GPT-5.5]       (terpilih: GPT-5.6 Terra)
  Effort codex            → [ultra … low]                 (terpilih: high)

model · Model sesi — default global
  Model                   → [Opus 5 | Sonnet 5 | Haiku 4.5 | Fable 5]   (terpilih: Opus 5)
  Effort                  → [x-high … ultracode]                        (terpilih: x-high)
```

Nilai `aria-label` pada kartu kedua **memang** `Model claude`/`Effort claude` — tapi itu hanya
dibaca screen reader dan test; **teks yang terlihat mata hanya "Model" dan "Effort"**.

### Akar masalah

`src/src/screens/SettingsScreen.tsx` (blok `if (tab === "model")`, baris 523–596) membagi tab jadi
dua kartu dengan sumbu yang **tidak konsisten**:

| Kartu | Isi | Sumbu |
|---|---|---|
| `Agen sesi` | agen default **+ model codex + effort codex** | agen *dan* katalog codex |
| `Model sesi — default global` | `s.model` + `s.effort` (claude) | katalog claude, tanpa menyebut agennya |

Empat akibat langsung:

1. **Asimetri penamaan.** Blok codex diberi nama eksplisit (`Model codex`, `Effort codex`); blok
   claude tidak (`Model`, `Effort`). Yang satu jelas milik siapa, yang lain harus ditebak.
2. **Judul yang bisa berbohong.** Kartu claude berjudul *"Model sesi — default global"*, padahal
   saat `agent = "codex"` default global yang benar-benar dipakai sesi baru adalah
   `codex.model`/`codex.effort` — bukan `s.model`. `sessionAgentDefaults()`
   (`server/src/services/settings.ts:68`) memilih blok berdasarkan `Setting.agent`:

   ```ts
   return s.agent === "codex"
     ? { agent: "codex", model: s.codex.model, effort: s.codex.effort }
     : { agent: "claude", model: s.model, effort: s.effort };
   ```

   Jadi layar menampilkan "default global = Opus 5" sementara sesi berikutnya lahir
   `gpt-5.6-terra`. Judulnya benar untuk claude, salah sebagai klaim global.
3. **Tak ada penanda mana yang aktif.** Kedua blok tampil sama-sama menonjol; tak ada apa pun yang
   memberi tahu operator bahwa mengubah salah satunya tak berpengaruh pada sesi baru sekarang.
4. **Katalog claude terduplikasi.** `S_MODELS`/`S_EFFORT` (`SettingsScreen.tsx:13–24`) menyalin
   `MODELS`/`EFFORTS` dari `@hanoman/shared` — yang dipakai picker Start (`App.tsx:98–100`).
   Komentarnya sendiri berbunyi *"Keep in sync with the server default"*: dua sumber untuk satu
   katalog, artinya picker Start dan Settings bisa menampilkan daftar model claude yang berbeda.
   Blok codex tak punya masalah ini — ia sudah membaca `CODEX_MODELS` dari shared.

Ini bukan regresi: kartu claude sudah ada sejak SPEC-252/ADR-0061 ketika **hanya ada claude**, lalu
SPEC-338/ADR-0074 menempelkan codex sebagai kartu terpisah tanpa menamai ulang yang lama. Tab-nya
tumbuh menumpuk, tidak pernah ditata ulang sebagai "dua agen sejajar".

---

## Temuan B — sesi penyelesai konflik tak punya default yang bisa disetel

### Keadaan sekarang

Sejak SPEC-377, **ketiga** pintu konflik memanggil helper yang sama:

| Route | Kelahiran sesi |
|---|---|
| `POST /specs/:id/integrate` (backlog, `routes/specs.ts:248`) | `sessionAgentDefaults()` |
| `finishGraphOp` (git graph merge·rebase·pull·drop, `routes/ide.ts:352`) | `sessionAgentDefaults()` |
| `POST /terminal/sessions/:id/integrate` (PRD, `routes/terminal.ts:338`) | `sessionAgentDefaults()` |

`sessionAgentDefaults()` mengembalikan **default global yang sama persis** dengan yang dipakai sesi
kerja (backlog/PRD/reverse/scaffold). Tidak ada override per-request — itu keputusan sadar SPEC-377
(*"Tak ada override per-request — pilihan agen hidup di Settings"*) — dan **tidak ada knob khusus
konflik di Settings**. Jadi tidak ada satu pun tempat, di seluruh sistem, untuk menyatakan
"selesaikan konflik dengan model X" tanpa ikut mengubah model semua sesi kerja.

### Bukti bahwa ini yang dikeluhkan

`src/src/screens/IntegrateDialog.tsx:36` menjanjikan secara harfiah:

> "Bila ada konflik, sesi agen membereskannya di Terminal — **memakai agen, model & effort dari
> Settings**."

Operator membaca kalimat itu, membuka Settings → **Model sesi**, dan tidak menemukan apa pun yang
menyebut konflik/rebase/merge. Janji UI menunjuk ke tempat yang tak menyediakan pilihannya.
Dokumen audit SPEC-377 sendiri sudah mencatat ini sebagai kandidat tindak lanjut
([audit SPEC-377](audit-spec-377-agen-model-effort-konflik-integrasi.md), bagian "Di luar skop").

### Kenapa layak dipisahkan

Menyelesaikan konflik merge adalah pekerjaan dengan bentuk berbeda dari mengeksekusi backlog: skopnya
sempit (beberapa berkas bertanda), tak berfase, tak ada plan, dan sering banyak terjadi berturut-turut.
Memaksanya memakai model & effort yang sama dengan sesi Execute berarti membayar effort tertinggi
untuk pekerjaan mekanis — atau sebaliknya, menurunkan model sesi kerja demi konflik yang murah.

---

## Keputusan pasca-Audit

Kedua temuan berconfidence tinggi:

- **A** dibuktikan dengan dump DOM nyata (teks terlihat vs `aria-label`), akarnya satu blok JSX di
  satu berkas frontend, dan `sessionAgentDefaults()` membuktikan judul "default global" memang bisa
  salah. Perbaikannya penataan ulang kartu — tanpa server, tanpa kontrak.
- **B** bentuknya persis mengikuti **tiga preseden yang sudah teruji** di repo ini: `goal`
  (SPEC-332/ADR-0073), `codex` (SPEC-338/ADR-0074), dan `verifyScope` (SPEC-376/ADR-0080) — semuanya
  blok baru di `zSetting` ber-`.default()`, **tanpa migration** (kolom `Setting.data` bertipe `Json`),
  dikonsumsi satu helper di `services/settings.ts`. Titik sentuhnya sudah dipetakan: 3 route yang
  seluruhnya sudah memanggil satu helper yang sama.

Tak ada percabangan yang mengubah bentuk data model maupun kontrak API (blob `zSetting` bertambah
satu kunci opsional-berdefault; tak ada endpoint baru). **Spec dan Plan dilewati** (ADR-0020/0040);
dokumen ini menjadi doc-of-record.

Satu keputusan desain diambil di sini dan dinyatakan terbuka: blok konflik dibuat **opt-in**
(`enabled: false` sebagai default), sehingga instalasi yang ada tidak berubah perilakunya sama sekali
sampai operator menyalakannya — konsisten dengan konvensi repo (scheduler, goal, `agentAccessEnabled`
semuanya default mati). Saat mati, sesi konflik tetap mewarisi `sessionAgentDefaults()` persis seperti
sekarang, dan kartunya **menampilkan nilai warisan itu** supaya tak ada pertanyaan "lalu sekarang pakai apa".

## Perbaikan

**Temuan A** — `SettingsScreen.tsx`, tab `Model sesi` ditata ulang jadi tiga kartu bersumbu agen:

1. `Agen sesi` menyisakan pilihan agen default saja.
2. `Model sesi — default global` memuat **dua grup sejajar berlabel agen**: "Claude Code" dan
   "Codex CLI", masing-masing dengan baris Model + Effort dan **badge status** (`dipakai sesi baru`
   vs `tidak dipakai sekarang`) yang diturunkan dari `agent` — sehingga judul "default global" tak
   lagi bisa dibaca sebagai klaim atas blok yang sedang tak aktif.
3. `S_MODELS`/`S_EFFORT` dihapus; katalog claude dibaca dari `MODELS`/`EFFORTS` (`@hanoman/shared`),
   sumber yang sama dengan picker Start.

`aria-label` (`Model claude`, `Effort claude`, `Model codex`, `Effort codex`, `Agen default`) dan
`data-testid="codex-version-note"` **dipertahankan apa adanya** — test yang ada bergantung padanya.

**Temuan B** — knob baru:

1. `@hanoman/shared` — `zConflict { enabled, agent, model, effort }` + `CONFLICT_DEFAULTS`, dipasang
   ke `zSetting` lewat `.default()` (baris `Setting` lama tetap parse, tanpa migration).
2. `server/src/services/settings.ts` — `conflictSessionDefaults()`: `enabled` mati → delegasi penuh
   ke `sessionAgentDefaults()`; hidup → blok konflik, dengan effort codex dikoersi
   (`coerceCodexEffort`) seperti blok codex global.
3. Tiga route konflik memanggil `conflictSessionDefaults()` alih-alih `sessionAgentDefaults()`.
   `ensureCodexTrust` tetap dipanggil berdasar agen **hasil** helper — bukan `Setting.agent` — kalau
   tidak, mengaktifkan override codex di atas default claude akan mengulang bug SPEC-377.
4. `SettingsScreen.tsx` — kartu `Konflik rebase & merge`; mati = tampilkan nilai warisan.
5. `IntegrateDialog.tsx` — kalimatnya menunjuk ke kartu itu.
6. ADR-0081 mencatat "sesi konflik boleh punya default sendiri, opt-in, mewarisi saat mati".

## Di luar skop (tercatat, sengaja tak diperbaiki)

- **Picker per-operasi integrasi** (cermin `StartSessionModal` di dialog Rebase/Merge). Ekspektasi
  yang ditulis pelapor adalah "bisa di setting defaultnya di setting" — itu terpenuhi tanpa mengubah
  bentuk body `POST /specs/:id/integrate`. Bila kelak diinginkan, itu fitur baru dengan kontrak baru.
- **`POST /vps/:id/session`** masih memakai `sessionModel()` (khusus claude) — drift yang sama dengan
  SPEC-377, tapi bukan sesi konflik. Tetap dicatat sebagai satu-satunya penghalang pensiunnya
  `sessionModel()`.
