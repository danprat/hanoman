# SPEC-488 — Setting runtime, model, dan effort untuk hanoman-lead

**Tanggal:** 2026-08-01 · **Sumber:** brief · **Prioritas:** sedang
**Status:** design disetujui (pipeline otonom, ADR-0035)

---

## 1. Temuan yang mengubah bentuk kerja

Brief menyatakan: *"runtime, model, dan effort agen lead masih terkunci pada default
kode/resolver."* Pemeriksaan kode membuktikan itu **benar dari sudut operator dan salah dari sudut
skema** — dan selisih itu yang menentukan seluruh bentuk pekerjaan ini.

Yang **sudah ada** (SPEC-409 · ADR-0091, tak pernah disentuh sesudahnya):

| Lapis | Berkas | Keadaan |
|---|---|---|
| Skema | `shared/src/entities.ts:237` `zLeadEngine` `{enabled,agent,model,effort}`, dipasang `zLead.engine` | **ada** |
| Resolver | `server/src/services/lead/config.ts:27` `leadAgentDefaults()` — `engine.enabled` mati → `sessionAgentDefaults()`, hidup → triple lead + `coerceCodexEffort` | **ada** |
| Choke point | `decide.ts:141` `await deps.defaults()` → `decide.ts:157` `deps.think(prompt,{agent,model,effort,…})` | **ada, tunggal** |
| Argv | `brain.ts:34` `leadArgv()` → claude `--model/--effort`, codex `-m/-c model_reasoning_effort` | **ada** |
| Kontrak HTTP | `PUT /api/lead/config` (`zLead` penuh, memuat `engine`) dan `PUT /api/settings` (`zSetting` penuh) | **ada** |
| Docs SoT | `data-model.md:227`, `api-contract.md:786` sudah menyebut blok `engine` | **ada** |

Yang **tak pernah ada**:

1. **Kontrol UI mana pun.** `grep -rn "engine" src/src/` → nol kecocokan yang berhubungan dengan
   lead. `SettingsScreen` hanya menyebut `lead: LEAD_DEFAULTS` di objek default; `LeadScreen`
   menerima `config: Lead` penuh dari `GET /lead/status` lalu **membuang** `engine`. Satu-satunya
   jalan menyetelnya hari ini adalah `curl PUT /api/lead/config` dengan blok `Lead` utuh dirakit
   tangan — operator dashboard **tidak punya jalan sama sekali**, dan itulah keluhan yang sah.
2. **Satu pun test.** `grep -rn "leadAgentDefaults" server/test` → nol. `lead-decide.test.ts`
   menyuntik `think` sebagai stub (kelas jebakan SPEC-448), jadi tak ada yang membuktikan nilai
   setelan sampai ke argv. Tak ada pula test yang membuktikan **fallback**-nya.
3. **Penyebutan permukaan operator di docs.** `data-model.md` menerangkan bentuk datanya, tapi tak
   satu doc pun mengatakan di mana manusia menyetelnya.

**Konsekuensi mengikat:** skema `Setting` **tidak berubah** → **tanpa ADR baru, tanpa migration**
(constraint brief: "Butuh ADR baru bila mengubah skema Setting" — syaratnya tak terpenuhi). Ini
mengubah spec dari "bangun fitur" menjadi **"buka permukaan operator untuk mesin yang sudah
lengkap, lalu ikat dengan bukti"** — dan bagian "bukti" menjadi bagian yang paling berbobot, karena
objective menuntut *"terbukti dari argv proses lead, bukan hanya bentuk respons API."*

## 2. Objective

Operator bisa menyetel **runtime (claude/codex) · model · effort** agen hanoman-lead dari dashboard
Settings; nilainya terbukti sampai ke **argv proses lead**; belum diisi → jatuh ke default lama;
ganti setelan berlaku **tanpa restart server**.

## 3. Keputusan desain

### D1 — Kartu di `SettingsScreen` → tab **Model sesi**, cermin kartu konflik (ADR-0081)

Brief menyebut "dashboard Settings" secara eksplisit. Tab **Model sesi** sudah menjadi rumah bagi
tiga kartu bersumbu agen (Agen sesi · Model sesi default global · Konflik rebase & merge) dan sudah
mengimpor seluruh katalog yang dibutuhkan (`MODELS`, `EFFORTS`, `CODEX_MODELS`, `codexEfforts`,
`coerceCodexEffort`, `codexModel`, `codexClientTooOld`). Kartu keempat **"Agen hanoman-lead"**
duduk di bawah kartu konflik dengan bentuk yang **persis sama**:

- `Switch` "Pakai setelan sendiri" → `engine.enabled`.
- Mati → satu baris `data-testid="lead-engine-inherited"` yang **menyebutkan nilai warisan** yang
  benar-benar berlaku (hasil `sessionAgentDefaults()`, dihitung di klien dari `s.agent`/`s.model`/
  `s.effort`/`s.codex`). Tanpa baris ini operator ditinggal bertanya "lalu lead pakai apa?" —
  pelajaran yang sudah dibayar SPEC-383.
- Hidup → tiga `Select`: **Agen** (`Claude Code`/`Codex CLI`), **Model** (katalog per agen; nilai di
  luar katalog disisipkan apa adanya lewat `codexOptions`), **Effort** (claude `S_EFFORT`; codex
  `codexEfforts(model)` — effort adalah properti **per-model**, SPEC-339).
- Menukar **agen** menukar model+effort sekalian ke default agen itu (cermin `pickAgent`); memilih
  model codex mengoersi effort-nya (`coerceCodexEffort`) — tanpa itu blok bisa menyimpan pasangan
  yang nanti ditolak codex.
- Catatan lunak versi codex CLI (`codexNote`) ikut dipasang, sumber yang sama dengan dua kartu lain.

**Ditolak:** menaruhnya di `LeadScreen`. Brief menyebut Settings; dan katalog model/effort beserta
seluruh aturan koersinya sudah hidup di tab Model sesi — menyalinnya ke layar kedua adalah kelas bug
"satu definisi, N call site" yang sudah dibayar SPEC-431/448/475/481.

### D2 — Kartu itu menulis lewat `PUT /lead/config`, **bukan** `PUT /settings`

Ini **beda sadar** dari kartu konflik, dan alasannya bukan selera:

`SettingsScreen.persist()` mengirim **seluruh objek `Setting`** dari snapshot yang dimuat **sekali**
saat mount (`load()` di `useEffect`, tanpa polling, tanpa reload sesudah save). Untuk `conflict` itu
aman — blok itu **tak punya penulis kedua**. `lead` punya: `LeadScreen` menulis blok yang sama lewat
`PUT /lead/config` (rem darurat Pause, denyut, batas waktu, opt-in per project). Urutan yang sangat
mungkin terjadi:

1. Operator membuka Settings (snapshot `lead.paused = false` tersimpan di state React).
2. Sesuatu memburuk; operator pindah ke Lead → **Pause**.
3. Kembali ke Settings, mengganti model lead → `PUT /settings` mengirim snapshot lama →
   **`paused` kembali `false`**, lead menyala lagi tanpa satu pun klik yang mengatakannya.

Rem darurat yang bisa lepas sendiri adalah kegagalan yang lebih mahal daripada penghematan satu
round-trip. Karena itu kartu lead melakukan **read-modify-write bersegar**:

```
onChange → cfg = await api.getLeadConfig()          // blok lead SEGAR dari server
         → await api.putLeadConfig({ ...cfg, engine: { ...cfg.engine, ...patch } })
         → setS(prev => ({ ...prev, lead: hasil }))  // samakan snapshot lokal
```

Hanya blok `lead` yang tersentuh, dan field lead lain datang dari server, bukan dari snapshot.
Kegagalan → toast `err`, state lokal **tidak** digeser (pola "jangan fallback ke default saat GET
gagal" yang sudah berlaku di layar ini).

**Catatan jujur, di luar scope:** bahaya snapshot-basi itu **sudah ada hari ini** untuk setiap save
di Settings (mengganti model claude pun mem-PUT blok `lead` lama). Spec ini tidak memperbaikinya
secara umum — itu perubahan pada pola tulis seluruh layar dan pantas jadi spec sendiri — tetapi juga
**tidak menambah** permukaannya, dan kartu barunya justru kebal.

### D3 — `LeadScreen` menampilkan mesin yang dipakai, tanpa data baru

`ControlBar` mendapat satu baris: `mesin: Claude Code · claude-opus-5 · xhigh` saat
`engine.enabled`, atau `mesin: ikut default global (Settings → Model sesi)` saat mati. Datanya sudah
ada di `cfg` yang dipoll layar itu — **nol permintaan baru, nol perubahan DTO**. Layar tempat
operator mengurus lead tak boleh diam soal pertanyaan "lead ini dijalankan siapa".

### D4 — Bukti sampai ke **argv**, tiga lapis

Objective menuntut bukti argv. Rantainya diikat dari tiga sisi supaya tak ada lapis yang bisa putus
diam-diam:

1. **Resolver** (`server/test/lead-engine-argv.test.ts`, baru) — `leadAgentDefaults()` terhadap
   baris `Setting` sungguhan di DB test: `engine` mati → warisan (claude **dan** codex), hidup →
   triple lead, codex ber-effort di luar katalog model → dikoersi.
2. **Argv end-to-end** (berkas yang sama — resolver dan argv adalah satu rantai, memisahnya membuat
   dua berkas yang harus diubah bersamaan) — `decide()` dengan
   **`prodDecideDeps` apa adanya** (`think` NYATA, `defaults` NYATA) dan `HANOMAN_CLAUDE_BIN`/
   `HANOMAN_CODEX_BIN` menunjuk fixture perekam argv → assert argv memuat `--model <m> --effort <e>`
   (claude) dan `-m <m> -c model_reasoning_effort="<e>"` (codex), diturunkan dari baris `Setting`
   yang ditulis test. Ini satu-satunya bentuk yang membuktikan setelan **DB → argv**; `lead-decide`
   yang menyuntik stub `think` secara struktural tak bisa.
3. **Smoke nyata** (sekali di akhir) — server di-boot dengan `HANOMAN_CLAUDE_BIN` menunjuk perekam,
   lalu `PUT /api/lead/config` + `POST /api/lead/decisions` lewat curl, lalu **berkas rekaman argv
   dibaca**. Menutup jalur yang tak dilewati test unit: gerbang route, capability, dan urutan boot.

Fixture baru **`server/test/fixtures/fake-lead-argv.sh`**: menulis argv-nya ke
`$HANOMAN_LEAD_ARGV_FILE` lalu mencetak satu blok ```json putusan yang **sah**, sehingga `decide()`
berjalan sampai tuntas alih-alih tercatat `gagal`. `fake-lead-agent.sh` yang ada tidak dipakai untuk
ini — ia mencetak `args:` ke stdout dan tak pernah mengeluarkan JSON, jadi `decide()` akan berhenti
di parser sebelum sempat menulis apa pun.

### D5 — "Tanpa restart" sudah terpenuhi secara struktural, dan itu diuji

`getSetting()` membaca baris `Setting` **tiap panggilan** — tanpa cache, tanpa modul-level memo —
dan `leadAgentDefaults()` memanggilnya di dalam `decide()`, yakni tepat sebelum tiap putusan. Jadi
"ganti setelan tanpa restart" bukan fitur yang perlu dibangun melainkan sifat yang perlu **dikunci**:
test argv menjalankan `decide()` **dua kali dalam satu proses** dengan baris `Setting` yang diubah di
antaranya, dan menuntut argv kedua berbeda. Tanpa test itu, siapa pun yang kelak menambahkan cache di
`getSetting()` merusak AC ini tanpa satu pun tanda.

## 4. Bentuk data (tidak berubah)

```ts
// shared/src/entities.ts — SUDAH ADA, tak disentuh
zLeadEngine = { enabled: boolean(false), agent: "claude"|"codex", model: string, effort: string }
zLead.engine = zLeadEngine.default({})
```

Tanpa kolom baru, tanpa model baru, tanpa migration, tanpa endpoint baru, tanpa ADR baru.

## 5. Rencana verifikasi

- `server/test/lead-engine-argv.test.ts` (baru, resolver + argv),
  `src/test/settings-lead-engine.test.tsx` (baru), `src/test/lead-screen.test.tsx` (ditambah).
- Typecheck **hanya** paket tersentuh: `pnpm --filter ./server typecheck`, `pnpm --filter ./src typecheck`
  (`shared` tak berubah).
- Smoke: boot server di DB khusus + port bebas, `HANOMAN_CLAUDE_BIN` = perekam argv, curl
  `PUT /lead/config` → `POST /lead/decisions` → baca rekaman.
- Test server dijalankan dengan `--no-file-parallelism` **dan** `TEST_DATABASE_URL` sendiri
  (SPEC-479 — DB test diturunkan dari `HANOMAN_HOME`, bukan checkout).

## 6. Docs yang tersentuh (commit yang sama)

- `internal/docs/architecture/data-model.md` — bullet `lead`: tambahkan **di mana operator
  menyetelnya** dan mengapa kartunya menulis lewat `PUT /lead/config`.
- `internal/docs/frontend/frontend-implementation.md` — section baru "Settings → Model sesi → Agen
  hanoman-lead" (pola section "Settings → Telegram").
- `internal/skills/hanoman/SKILL.md` — butir hanoman-lead: blok `engine` punya permukaan operator +
  gotcha penulis-kedua.
- `internal/docs/README.md` — tak ada berkas doc baru; index tetap sinkron (diperiksa, bukan diubah,
  kecuali ada tautan yang meleset).

## 7. Risiko & jebakan yang sudah diketahui

| Risiko | Penangkal |
|---|---|
| Fixture Settings lama (`settings-conflict.test.tsx` dll.) tak punya kunci `lead` | `s.lead ?? LEAD_DEFAULTS`, cermin `?? CONFLICT_DEFAULTS` |
| Mock `api` di test Settings lama hanya punya 3 fungsi | Kartu lead **tidak** memanggil `getLeadConfig` saat render — hanya saat operator menyimpan |
| `effort` codex di luar katalog model tersimpan | `coerceCodexEffort` di UI **dan** di `leadAgentDefaults()` (dua lapis, sudah ada di server) |
| `fake-claude.sh` (`exec cat`) dipakai untuk agen one-shot | Fixture sendiri yang **keluar sendiri** — jebakan SPEC-448 |
| `HANOMAN_CLAUDE_BIN` dikalahkan entri config DB (`effectiveStr` baca cache DB dulu) | Smoke memakai DB kosong khusus; test unit menyetel `process.env` saja |
| Smoke menyentuh DB nyata (`DATABASE_URL` di profil shell menang atas `HANOMAN_HOME`) | Smoke menyetel `DATABASE_URL` eksplisit ke berkas `mktemp` |
