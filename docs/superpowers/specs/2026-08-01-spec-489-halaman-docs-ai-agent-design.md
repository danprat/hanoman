# SPEC-489 — Halaman dokumentasi AI Agent lewat URL (design)

Design doc. Sumber: brief SPEC-489, `internal/docs/README.md`, `docs/agent-integration.md`,
`server/src/app.ts`, `server/src/services/agent-capabilities.ts`, `server/src/routes/specs.ts`,
`shared/src/{agent,entities,dto,mcp-shape}.ts`, `cli/src/release/pack.ts`, `src/vite.config.ts`.
Tanggal: 2026-08-01.

## 1. Masalah

Panduan cara AI agent memakai hanoman hidup di dua tempat yang **tak punya URL**: skill lokal
(`~/.claude/skills/hanoman/**`, per-mesin) dan `docs/agent-integration.md` di dalam git. Akibatnya
memberi kemampuan hanoman ke agen mana pun menuntut manusia menyalin panduan secara manual, dan
salinannya langsung mulai basi.

Yang diinginkan: **satu tautan + satu agent token** cukup untuk membuat agen bekerja, tanpa satu
kalimat penjelasan tambahan dari manusia.

## 2. Temuan yang mengikat desain

1. **Panduannya sudah ada.** `docs/agent-integration.md` (SPEC-257/265 · ADR-0065, diperluas
   SPEC-450/482) sudah memuat auth, capability, tabel 403, cookie-only, MCP. Ia ditaut dari
   **empat** tempat: `internal/docs/README.md:48`, `internal/docs/architecture/api-contract.md:393`,
   `internal/docs/operations/gtm.md:39`, dan tombol "Dokumentasi integrasi" di
   `SettingsScreen.tsx:405` (yang menunjuk blob GitHub). Membuat dokumen **kedua** akan melanggar
   kendala "satu sumber tulisan" sejak hari pertama. → **Perluas berkas itu**, jangan bikin baru.
2. **Vite dev-server hanya mem-proxy `/api`** (`src/vite.config.ts`). URL di luar `/api` tak akan
   pernah bekerja di `pnpm dev`, dan di produksi ia milik SPA-fallback (`app.ts`). → URL kanoniknya
   wajib di bawah `/api`.
3. **Paket npm tak membawa `docs/`.** `copyPlan()` (`cli/src/release/pack.ts:69`) menyalin delapan
   artefak; `docs/**` bukan salah satunya, dan `files:` di `packageJsonFor` tak memuatnya. Menyajikan
   berkas dari disk berarti berkas itu harus ikut ter-pack, dijaga `REQUIRED_ARTIFACTS`.
4. **Dua layout, seperti aset dashboard.** `server/src` (dev, tsx) dan `server/dist` (build) sama-sama
   dua tingkat di bawah root checkout; paket npm menaruh `dist/server.js` satu tingkat di bawah root
   paket. Preseden penyelesaiannya sudah ada dan murni: `pickWebDir()` (`server/src/web-dir.ts`).
5. **Isi dokumen sudah publik.** Repo `denameidina/hanoman` publik & MIT (`REPO_URL`,
   `packageJsonFor.license`), dan tombol Settings sudah menautkan blob GitHub-nya. Menyajikan byte
   yang sama tanpa auth **bukan** paparan baru.
6. **Katalog capability terbaca mesin.** `CAPABILITY_DOMAINS` (12 domain) dan daftar `COOKIE_ONLY` di
   `capabilityForRoute()` adalah data. Dokumen prosa bisa basi terhadap keduanya — dan **sudah**:
   §3 dokumen sekarang belum menyebut domain `telegram`, §5 belum menyebut `/api/webhooks*` dan
   `/api/telegram/{settings,test,credentials}` yang cookie-only sejak ADR-0097/0100.

## 3. Keputusan

### K1 — Satu berkas markdown, disajikan mentah lewat `/api`

`docs/agent-integration.md` tetap **satu-satunya** naskah. Server menyajikan **byte yang sama** di:

```
GET /api/agent-integration.md   →  200 text/markdown; charset=utf-8
```

Basename URL = basename berkas = basename blob GitHub. Tak ada transformasi, tak ada salinan.

### K2 — Endpoint itu PUBLIC (tanpa auth)

Masuk `PUBLIC` di `app.ts`, sejajar `GET /api/health`. Alasan, urut kekuatan:

- Agen yang tokennya kurang capability akan menerima **403 pada dokumen yang menjelaskan arti 403**.
  Gerbang yang menyembunyikan manualnya sendiri adalah kegagalan diagnosis, bukan keamanan.
- Byte-nya sudah publik di GitHub (temuan 5) → paparan marginal = nol.
- "Cukup diberi link + token" hanya benar bila link-nya bisa dibaca **sebelum** token disetel; itu
  juga yang membuat probe "host benar / token salah" mungkin (kelas gotcha 3 ADR-0099).

Konsekuensi yang diterima sadar: instance yang sengaja diekspos internet menyiarkan permukaan
API-nya. Itu sudah benar untuk repo publik; dokumen **tak boleh** memuat token nyata — dijaga test.

### K3 — Resolver murni, dijaga test, seperti `pickWebDir`

`server/src/guide-file.ts` → `pickGuideFile(distDir, env, exists): string | null`.

| Kandidat | Layout |
|---|---|
| `<distDir>/../docs/agent-integration.md` | paket npm (`<pkg>/dist/server.js`) |
| `<distDir>/../../docs/agent-integration.md` | checkout: `server/dist` **dan** `server/src` (tsx dev) |

`HANOMAN_AGENT_DOC` meng-override; di-set tapi tak ada → **melempar** (cermin `HANOMAN_WEB_DIR`:
"dokumen hilang tanpa pesan" mahal didiagnosis). Tak ketemu tanpa override → `null` → route menjawab
**404 JSON** dengan pesan yang menyebut penyebabnya, bukan 500.

### K4 — Ikut ter-pack, dijaga gerbang rilis

- `copyPlan()` += `docs/agent-integration.md`
- `packageJsonFor().files` += `"docs"`
- `REQUIRED_ARTIFACTS` += `"docs/agent-integration.md"` → `hanoman __pack` gagal keras bila hilang.

### K5 — Permukaan dashboard: kartu di Settings → Akses AI Agent

Mengikuti preseden `WebhookDocs` (SPEC-481) & `McpPanel` (SPEC-482): satu kartu **"Dokumentasi AI
Agent"** berisi URL absolut siap-salin (`${origin}/api/agent-integration.md`), tombol **Salin**,
tombol **Buka** yang merender markdown-nya lewat `DocPreviewModal` + `MarkdownView` (`ds/markdown.tsx`)
dari isi endpoint itu sendiri, dan tautan mirror GitHub. Karena yang dirender adalah respons
endpoint, in-app **tak bisa** berbeda dari GitHub.

Bukan section sidebar baru: satu dokumen statis tak membenarkan item nav, dan tak ada preseden
dokumentasi berdiri sendiri di sidebar.

### K6 — Dokumen diikat ke katalog oleh test, bukan oleh render

Kendala "satu sumber" memaksa naskah jadi markdown, jadi tabel capability/cookie-only tak bisa
di-render dari katalog seperti `WebhookDocs`. Gantinya **test kontrak** (`server/test/agent-doc-contract.test.ts`):

1. setiap `domain` di `CAPABILITY_DOMAINS` muncul di dokumen;
2. setiap segmen `COOKIE_ONLY` di `capabilityForRoute()` muncul di §5;
3. setiap nilai `zSpecSource` muncul di tabel payload;
4. dokumen **tak** memuat token yang terlihat nyata (`/hnm_agt_[0-9a-f]{16,}/`).

Katalog bertambah → test merah → dokumen ikut diperbarui. Itu jaminan anti-basi yang sama dengan
`WEBHOOK_ENTITIES`, dibayar dengan test alih-alih renderer kedua.

## 4. Isi dokumen (struktur akhir)

Urutan disusun untuk pembaca **agen**, bukan manusia: siapa kamu → cara masuk → apa yang boleh →
apa yang dilarang → apa yang berbahaya → jebakan → contoh.

| § | Isi | Status |
|---|---|---|
| 0 | **Apa itu hanoman & model kerjanya** — backlog item → sesi agen di tmux → git worktree terisolasi per backlog; fase = giliran dalam satu sesi; docs = Source of Truth | **baru** |
| 1 | Nyalakan akses & buat token (manusia, sekali) | ada |
| 2 | **Base URL & autentikasi** — `HANOMAN_HOST` (tanpa `/` di ekor, seluruh path berawalan `/api`), `Authorization: Bearer hnm_agt_…`, `?agent_token=` untuk WS, probe `GET /api/health` | diperluas |
| 3 | Capability — 12 domain × 2, write ⊇ read | diperluas (+`telegram`) |
| 4 | Gate & kode status — 401/403 + arti field `need` | ada |
| 5 | Cookie-only yang selalu 403 | diperluas (+`webhooks`, +`telegram/{settings,test,credentials}`) |
| 6 | **Endpoint yang paling sering dipakai** — tabel method·path·capability | **baru** |
| 7 | **`POST /specs` — bentuk payload per `source`** (`brief`/`qa`/`goal`/`audit`/`help`) + aturan `superRefine` | **baru** |
| 8 | **Tindakan berbahaya: wajib konfirmasi manusia** — `POST /terminal/sessions`, `/api/vps*`, `POST /lead/decisions` | **baru** |
| 9 | **Jebakan yang sudah diketahui** | **baru** |
| 10 | Contoh alur end-to-end siap salin | diperluas |
| 11 | Minta putusan ke hanoman-lead | ada (§6b sekarang) |
| 12 | Keamanan | ada |
| 13 | MCP server | ada (§8 sekarang) |

### §8 — tindakan berbahaya

Tiga, dengan alasan mengapa masing-masing menuntut kalimat "manusia sudah menyetujui" sebelum
dipanggil, bukan sekadar capability:

| Tindakan | Kenapa |
|---|---|
| `POST /api/terminal/sessions` | melahirkan proses agen `--dangerously-skip-permissions` di worktree — RCE efektif; batas satu-satunya isolasi worktree (ADR-0037) |
| `POST/PUT/DELETE /api/vps*` | remote exec di server produksi |
| `POST /api/lead/decisions` | putusannya **menggerakkan sesi** (integrate/stop) dan melahirkan baris jejak permanen (ADR-0091/0098) |

Cerminnya sudah ada di katalog MCP (ADR-0099: ketiganya sengaja tak punya tool) — dokumen menyebut
itu sebagai preseden, bukan aturan baru.

### §9 — jebakan (semuanya terverifikasi di kode)

| Jebakan | Bukti |
|---|---|
| `startable` hanya bereaksi pada string **`"true"`**; nilai lain diabaikan **senyap** | `routes/specs.ts` `filterSpecs`: `f.startable !== "true" \|\| s.stage !== "done"` |
| `q` mencari di `id + title + objective` saja — **tak menyentuh `payload`** | `filterSpecs`: `` `${s.id} ${s.title} ${s.objective}` `` |
| Jangan kirim `id` atau `stage` saat `POST /specs` — zod non-strict **membuangnya diam-diam**; id diturunkan `nextSpecId()`, stage selalu mulai `brainstorming` | `zCreateSpec` (`shared/src/dto.ts:60`) tak punya kedua field itu |
| `GET /specs/:id` **tidak ada** — ambil lewat `GET /specs?q=<ID>` lalu cocokkan `id` persis | enumerasi route `routes/specs.ts` |
| `source` dan bentuk `payload` **saling mengikat**; salah pasang → 400 `"bentuk payload tak cocok dengan source"` | `zCreateSpec.superRefine` |
| Daftar mengembalikan amplop `{ items, total, page, pageSize }`, bukan array telanjang | `services/paginate.ts` |
| `PATCH /specs/:id` menolak edit konten setelah item dimulai; `stage` hanya boleh **mundur** | SPEC-186, ADR-0027 |

## 5. Berkas yang tersentuh

**Baru**
- `server/src/guide-file.ts` — resolver murni
- `server/src/routes/agent-doc.ts` — satu route GET
- `server/test/guide-file.test.ts`, `server/test/agent-doc.route.test.ts`, `server/test/agent-doc-contract.test.ts`
- `src/src/screens/AgentDocCard.tsx` + `src/src/screens/AgentDocCard.test.tsx`

**Diubah**
- `docs/agent-integration.md` — naskah tunggal (bagian terbesar pekerjaan)
- `server/src/app.ts` — `PUBLIC` += entri, register route
- `cli/src/release/pack.ts` + `cli/test/pack.test.ts` — copyPlan/files/REQUIRED_ARTIFACTS
- `src/src/screens/SettingsScreen.tsx` — pasang kartu
- `src/src/api.ts` (atau setara) — fetch teks mentah
- `README.md` — tautan "Untuk AI agent"
- `internal/docs/README.md` — perbarui entri §integrasi (URL runtime + basis in-app)
- `internal/docs/architecture/api-contract.md` — endpoint publik baru
- `internal/skills/hanoman/SKILL.md` — satu butir

## 6. Test

| Berkas | Menjaga |
|---|---|
| `guide-file.test.ts` | tiga layout + override + override-salah melempar + tak-ketemu → null |
| `agent-doc.route.test.ts` | 200 `text/markdown`; **tanpa auth apa pun** (app ber-`requireAuth: true`); tetap 200 dengan agent token ber-capability **kosong**; berkas absen → 404 JSON |
| `agent-doc-contract.test.ts` | empat kontrak K6 |
| `pack.test.ts` | `copyPlan` memuat dokumen; `files` memuat `docs`; `REQUIRED_ARTIFACTS` memuatnya |
| `AgentDocCard.test.tsx` | URL absolut tampil & bisa disalin; tombol Buka merender isi dari endpoint |

Smoke sekali di akhir: boot server + `curl -i $HOST/api/agent-integration.md` **tanpa header auth**.

## 7. Yang sengaja TIDAK dikerjakan

- Tak ada endpoint `/api/docs/*` generik — satu berkas, satu route. Direktori dokumen yang bisa
  dijelajah adalah permukaan baca berkas arbitrer; itu keputusan lain dengan konsekuensi lain.
- Tak ada PDF/HTML render server-side (ADR-0078 untuk dokumen project, bukan untuk ini).
- Tak ada versi bahasa Inggris. Seluruh UI & katalog MCP berbahasa Indonesia; dua naskah = dua
  sumber, persis yang dilarang kendala.
- Tak ada ADR. Ini tak mengubah keputusan arsitektur mana pun: ADR-0065 (agent token & capability),
  ADR-0087 (bentuk paket npm), dan ADR-0099 (MCP) semuanya **ditegakkan**, bukan diamandemen.
  Yang ditambah adalah satu berkas statis yang bisa diambil lewat HTTP.
