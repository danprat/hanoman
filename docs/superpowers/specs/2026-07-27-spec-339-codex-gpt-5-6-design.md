# SPEC-339 — Katalog Codex GPT-5.6 (Sol / Terra / Luna) + effort `max` & `ultra`

Tanggal: 2026-07-27 · Status: design disetujui · ADR: tidak ada (perluasan ADR-0074) · Migration: tidak ada

## Objective

Sesi codex bisa memakai trio GPT-5.6 (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`) berikut dua
tingkat effort barunya (`max`, `ultra`), **tanpa** pernah melahirkan kombinasi model×effort yang
ditolak Codex CLI.

## Latar

SPEC-338 (ADR-0074) menambahkan `Agent = claude | codex` dan katalog codex pertama: `CODEX_MODELS`
(4 entri) + `CODEX_EFFORTS` (4 nilai) sebagai **dua daftar sejajar** — asumsinya setiap model codex
mendukung effort yang sama persis, seperti halnya claude.

GPT-5.6 mematahkan asumsi itu. Effort kini properti per model, bukan properti CLI.

## Temuan verifikasi (diuji langsung, bukan dari ingatan)

Sumber: manifest `codex debug models` pada codex-cli **0.145.0**, silang dengan
`codex-rs/models-manager/models.json` upstream dan docs model OpenAI.

| Slug | `minimal_client_version` | Default effort | Effort didukung |
|---|---|---|---|
| `gpt-5.6-sol` | 0.144.0 | `low` | low, medium, high, xhigh, **max**, **ultra** |
| `gpt-5.6-terra` | 0.144.0 | `medium` | low, medium, high, xhigh, **max**, **ultra** |
| `gpt-5.6-luna` | 0.144.0 | `medium` | low, medium, high, xhigh, **max** — **tanpa `ultra`** |
| `gpt-5.5` | 0.124.0 | `medium` | low, medium, high, xhigh |
| `gpt-5.4`, `gpt-5.4-mini` | 0.98.0 | medium | low, medium, high, xhigh |
| `gpt-5.3-codex-spark` | — | high | low, medium, high, xhigh |

Yang penting dan tak terduga:

1. **Katalog model di-fetch, bukan di-compile.** Codex menyimpannya di `~/.codex/models_cache.json`
   berikut `client_version`; server manifest **menyaring berdasarkan versi klien**. Karena itu
   codex-cli 0.142.5 yang terpasang sebelumnya tak pernah melihat GPT-5.6 sama sekali, sekalipun
   cache-nya di-refresh hari itu juga. Ini bukan soal langganan atau flag — murni gerbang versi.
2. **`max` belum ada di 0.142.5.** Enum `ReasoningEffort` pada biner 0.142.5 berbunyi
   `low|medium|high|xhigh|ultra`; pada 0.145.0 menjadi `low|medium|high|xhigh|max|ultra`. Jadi
   `-c model_reasoning_effort="max"` pada CLI lama adalah kegagalan senyap.
3. **`ultra` bukan sekadar "lebih tinggi dari max".** Deskripsi resminya "maximum reasoning with
   automatic task delegation" — ia men-spawn subagent. Relevan untuk hanoman karena memory proyek
   mencatat subagent async pernah membuat agen `end_turn` lebih awal dan fase terlihat selesai
   padahal belum. `ultra` tidak dijadikan default di mana pun.
4. **Default resmi Sol adalah `low`**, dengan anjuran "mulai rendah, naikkan untuk kerja berat".
   hanoman tetap memakai `xhigh` sebagai default agar sejajar dengan default claude (Opus 5 + xhigh);
   ini penyimpangan sadar dari anjuran OpenAI, bukan kelalaian.
5. **`gpt-5.3-codex-spark` masih dilayani.** Ia absen dari `models.json` upstream dan `gpt-5.4`/`mini`
   di sana bertanda `visibility: hide`, tetapi manifest yang benar-benar dikirim ke klien 0.145.0
   masih menampilkan ketiganya sebagai `list`. Keputusan memangkas mereka dari picker adalah pilihan
   kurasi (mengikuti arah deprekasi upstream), **bukan** karena mereka mati.

Prasyarat lingkungan: codex CLI di mesin dev sudah di-upgrade 0.142.5 → **0.145.0**
(`bun install -g @openai/codex@latest`) dan trio 5.6 terkonfirmasi muncul di `codex debug models`.

## Keputusan (dijawab manusia)

| Pertanyaan | Jawaban |
|---|---|
| Effort per model atau daftar flat? | **Per model** — UI hanya menampilkan yang valid |
| Model lama (`5.4`, `5.4-mini`, `spark`)? | **Dipangkas** dari picker + peta pensiun untuk setelan lama |
| Default codex global | **`gpt-5.6-sol` + `xhigh`** (dari `gpt-5.5` + `xhigh`) |
| CLI < 0.144.0 | **Peringatan lunak**, tidak memblokir Start |

## Desain

### 1. Katalog membawa effort-nya sendiri — `shared/src/entities.ts`

`CODEX_MODELS` berubah dari daftar `{id,label}` menjadi daftar bertipe:

```ts
export type CodexModel = {
  id: string; label: string;
  efforts: readonly string[];   // urut kuat → ringan
  fallback: string;             // dipakai bila effort tersimpan tak didukung model ini
  minClient: string;            // minimal_client_version dari manifest codex
};
```

Isinya: `gpt-5.6-sol`, `gpt-5.6-terra` (enam effort, `minClient` 0.144.0), `gpt-5.6-luna` (lima,
tanpa `ultra`), `gpt-5.5` (empat, `minClient` 0.124.0). `fallback` semuanya `xhigh` — nilai yang
didukung setiap model dalam katalog.

Dua fungsi murni menemani katalog:

- `codexEfforts(modelId)` → daftar effort model itu; model tak dikenal → irisan aman
  `["xhigh","high","medium","low"]`, bukan daftar kosong (picker tak boleh pernah kosong).
- `coerceCodexEffort(modelId, effort)` → `effort` bila didukung, selain itu `fallback` model.
  Model tak dikenal → `effort` diteruskan apa adanya; server sengaja lenient (`z.string()`), dan
  katalog kita tak boleh jadi gerbang yang memblokir model baru yang belum kita daftar.

`CODEX_EFFORTS` tetap diekspor sebagai gabungan berurut (`ultra…low`) demi pemanggil lama, tetapi
**bukan lagi** sumber pilihan UI.

`RETIRED_CODEX_MODELS: Record<string,string>` memetakan `gpt-5.4`, `gpt-5.4-mini`,
`gpt-5.3-codex-spark` → **`gpt-5.5`**. Sengaja bukan ke 5.6: `gpt-5.5` butuh klien 0.124.0 sehingga
aman untuk mesin yang CLI-nya belum di-upgrade. Memetakan otomatis ke Luna akan memindahkan setelan
orang ke model yang CLI-nya belum sanggup jalankan — pensiun tak boleh merusak.

`zCodex` default model → `gpt-5.6-sol` (effort tetap `xhigh`), sehingga `CODEX_DEFAULTS` ikut.

### 2. Server — remap saat baca, koersi saat lahir

**`server/src/services/settings.ts`** · `getSetting()` sudah memetakan `RETIRED_MODELS` untuk claude
di satu baris; blok `codex` mendapat perlakuan cermin: model dipetakan lewat `RETIRED_CODEX_MODELS`,
lalu effort-nya di-`coerceCodexEffort` terhadap model hasil pemetaan. Baris `Setting` lama tak
pernah menyisakan nilai yang tak bisa dipilih lagi di UI.

**`server/src/services/pty.ts`** · `createSession` menjadi **titik cekik tunggal**: bila
`agent === "codex"`, `effort = coerceCodexEffort(model, effort)` sebelum argv dirangkai. Seluruh
kelahiran sesi bermuara di sini — `routes/terminal.ts` (enam jalur), `routes/ide.ts`, `routes/vps.ts`,
`services/session-launch.ts`, dan scheduler. Menaruh koersi di route berarti mengulangnya sembilan
kali dan tetap bocor lewat `POST` ber-`AgentToken` yang tak menyentuh UI sama sekali.

### 3. Frontend — picker mengikuti model

`StartSessionModal` (`src/src/App.tsx`) dan kartu "Agen sesi" di `SettingsScreen` mengganti
`CODEX_EFFORTS` dengan `codexEfforts(model)`; `onChange` model memanggil
`setEffort(coerceCodexEffort(next, effort))`. Efek yang terlihat: memilih Luna saat effort sedang
`ultra` menurunkan effort ke `xhigh` di depan mata pengguna, bukan diam-diam saat sesi lahir.

Kasus tepi yang harus eksplisit: `codex.model` tersimpan bisa berada **di luar** katalog (datang dari
`PUT /api/settings` ber-`AgentToken`, atau model baru yang belum kita daftar). Untuk itu Select model
menambahkan nilai tersimpan sebagai entri apa adanya bila tak ada di katalog — supaya picker tak
tampil kosong — dan effort-nya tidak dikoersi, konsisten dengan aturan "model tak dikenal → apa
adanya" di `coerceCodexEffort`.

### 4. Gerbang versi — lunak, observabilitas saja

`server/src/services/codex-version.ts` (baru): jalankan `<codexBin> --version`, parse
`codex-cli X.Y.Z`, gagal-diam ke `null`. Perbandingan versi numerik per segmen (bukan
`localeCompare` — `0.9.0` harus < `0.144.0`). Hasilnya di-cache di memori dengan **TTL 5 menit**,
bukan selamanya: mesin yang baru di-upgrade harus berhenti memperingatkan tanpa perlu restart
server, sementara TTL-nya cukup panjang agar endpoint tak men-spawn proses tiap render.

`GET /api/codex/version` → `{ version: string | null, minRequired: "0.144.0", ok: boolean }`.

UI menampilkan catatan inline di Settings dan picker Start bila versi terdeteksi lebih rendah dari
`minClient` model terpilih, memuat perintah upgrade. **Tidak memblokir Start** — sejalan dengan
ADR-0037 (agen dipercaya, isolasi lewat worktree); gagal jujur di terminal lebih baik daripada
gerbang baru. `version: null` (biner tak ditemukan / tak bisa dijalankan) tidak memunculkan
peringatan apa pun: ketiadaan bukti bukan bukti ketiadaan.

### 5. Runner — tanpa perubahan

`agentFlags` (`runner/src/agent-cli.ts`) sudah meneruskan `-c model_reasoning_effort="<v>"`.
`max` dan `ultra` hanyalah nilai enum baru; bentuk argv tak berubah sama sekali.

## Yang TIDAK berubah

- Skema Prisma, migration, dan bentuk `Setting` (tetap kolom `Json`).
- Kontrak `GET`/`PUT /api/settings` — `codex.model`/`codex.effort` tetap `string` lenient.
- Katalog claude (`MODELS`, `EFFORTS`, `RETIRED_MODELS`) sama sekali tak tersentuh.
- Alur sesi: worktree, fase, stage, review, integrate, mode goal, trust codex.
- Sesi yang sudah hidup: model/effort adalah argv saat lahir, jadi tak ada sesi berjalan yang berubah.

## Testing

**Unit — `shared`:** bentuk katalog (Luna tak memuat `ultra`; `minClient` trio 5.6 = 0.144.0);
`coerceCodexEffort` untuk luna+`ultra`→`xhigh`, `gpt-5.5`+`max`→`xhigh`, model asing→apa adanya,
kombinasi valid→tak berubah; `codexEfforts` model asing→irisan aman; peta pensiun→`gpt-5.5`.

**Unit — `server`:** `getSetting()` meremap baris `Setting` ber-`gpt-5.3-codex-spark` dan ikut
mengoreksi effort-nya; `createSession` codex dengan kombinasi tolak melahirkan argv ber-effort
fallback (assert pada argv, tanpa men-spawn); `codex-version` memparse `codex-cli 0.145.0` dan
membandingkan `0.142.5 < 0.144.0 ≤ 0.145.0`, serta mengembalikan `null` saat biner tak ada.

**UI:** `start-session-agent.test.tsx` & `settings-agent.test.tsx` diperbarui; assert opsi `ultra`
absen ketika Luna terpilih dan effort turun ke `xhigh` saat model ditukar dari Sol ke Luna.

**Smoke API nyata** (wajib per CLAUDE.md — boot server lalu curl): `GET /api/codex/version`,
`GET /api/settings`, `PUT /api/settings` dengan `codex.model = gpt-5.6-luna` + `effort = ultra` →
dibaca kembali sudah ter-koersi. Sesi codex sungguhan **tidak** di-spawn dalam smoke (memory proyek:
`POST /terminal/sessions` men-spawn agen betulan). Test server memakai DB base khusus
(`hanoman339`) dan `--no-file-parallelism`.

## Risiko

- **Mesin lain masih ber-CLI lama.** Default global berpindah ke `gpt-5.6-sol`, jadi instansi dengan
  codex < 0.144.0 akan melahirkan sesi ber-model yang manifest-nya tak mengenal. Peringatan lunak
  memberi tahu, tapi tak mencegah — konsekuensi sadar dari keputusan "jangan memblokir". VPS perlu
  ikut di-upgrade bila ia menjalankan sesi codex.
- **Nilai `ultra` dan subagent.** Bila `ultra` dipakai untuk sesi backlog, pola end_turn-dini yang
  tercatat di memory proyek bisa muncul lagi. Karena itu `ultra` hanya tersedia sebagai pilihan
  eksplisit, tak pernah default, dan tak dipakai scheduler.
- **Katalog kurasi bisa basi lagi.** Manifest codex berubah tanpa rilis hanoman. Mitigasinya murni
  konvensi: perbarui `CODEX_MODELS` terhadap `codex debug models` saat menyentuh area ini.

## Docs tersentuh (commit yang sama)

`internal/docs/adr/0074-codex-sebagai-mesin-sesi.md` (catatan katalog per-model),
`internal/docs/architecture/stack.md`, `internal/docs/architecture/api-contract.md`
(`GET /api/codex/version`), `internal/skills/hanoman/SKILL.md`, dan `internal/docs/README.md`.
