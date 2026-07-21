# audit SPEC-265 — belum ada dokumentasi resmi integrasi AI agent + tak ada link di UI

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major
**Tanggal:** 2026-07-21 · **Keputusan:** Spec & Plan **skipped** — temuan high-confidence, diff kecil, akar jelas. Dokumen ini = doc-of-record.
**Terkait:** [ADR-0065](../adr/0065-ai-agent-capability-agent-token.md) (SPEC-257 · fitur agent token) · [api-contract `## Agent tokens`](../architecture/api-contract.md)

## Keluhan

> saat ini belum ada documentasi resmi untuk ai agent melakukan integrasi dengan hanoman.
> Expected: ai agent capability docs link-nya dimunculkan sehingga untuk instalasi ai agent dapat langsung via link tersebut.

## Investigasi (root cause)

Fitur **AI agent capability** sudah lengkap end-to-end (SPEC-257 · ADR-0065):

- **Auth:** `Authorization: Bearer hnm_agt_<hex>` (WS: `?agent_token=`) — `server/src/services/agent-auth.ts`, gate di `server/src/app.ts:93-108`.
- **Capability:** 18 capability (9 domain × read/write, write⊇read) — katalog tunggal `shared/src/agent.ts` (`CAPABILITIES`, `grantsCapability`); peta route→capability `server/src/services/agent-capabilities.ts`.
- **Kelola token:** CRUD cookie-only `server/src/routes/agent-tokens.ts` (`/api/agent-tokens*`).
- **UI:** panel **"Akses AI Agent"** `src/src/screens/SettingsScreen.tsx:373-436` (master switch + buat/cabut token + grid capability).
- **SoT internal:** ADR-0065 + `api-contract.md` `## Agent tokens` sudah menjelaskan mekanismenya.

**Yang benar-benar hilang** (dua hal, keduanya berhadapan dengan pengguna/agen, bukan bug logika):

1. **Tak ada dokumentasi integrasi yang berhadapan-agen.** Semua penjelasan yang ada bersifat internal (ADR + api-contract sebagai SoT arsitektur) — tidak ada satu halaman "cara agen eksternal terhubung": langkah auth, format token, katalog capability, peta domain→endpoint, respons gate (401 vs 403 `{ need }`), pengecualian (`/auth`, `/agent-tokens`, `/device-tokens`, `/sync` cookie-only; `/ingest`/`/help` self-auth), WS `?agent_token=`, dan contoh `curl`. Bandingkan `sdk/README.md` yang memang berhadapan-pemakai untuk error-monitoring — padanan itu belum ada untuk agent capability.
2. **Panel "Akses AI Agent" tak menaut ke dokumentasi mana pun.** Manusia yang menyalakan akses tak punya link untuk diberikan ke agennya ("instalasi via link"). Semua tombol link eksternal lain di app sudah pola `<a href target=_blank><Button leftIcon="external-link">` (mis. `SettingsScreen.tsx:239`).

## Perbaikan (diff kecil)

1. **Buat** `docs/agent-integration.md` — panduan integrasi berhadapan-agen (padanan `sdk/README.md`), di-host publik di GitHub repo. Isinya: quick start (nyalakan master switch → buat token → `curl`), katalog capability + peta domain→endpoint, aturan gate & kode status, pengecualian cookie-only, WS terminal, keamanan/revoke.
2. **Tautkan dari UI:** tambah link "Dokumentasi integrasi" di card **Akses AI Agent** (`SettingsScreen.tsx`) → `https://github.com/denameidina/hanoman/blob/main/docs/agent-integration.md` (pola `<a target=_blank>` + Button `external-link`).
3. **Index SoT:** tambah baris di `internal/docs/README.md` bagian **integrasi**, dan pointer di `api-contract.md` `## Agent tokens` → panduan.

## Verifikasi

- Build client + server hijau (`pnpm build`).
- Boot server lokal, curl alur agent token nyata (create via cookie → panggil `/api/*` pakai Bearer → 401 saat master off, 403 `{ need }` saat kurang capability, 200 saat cukup) sesuai contoh di doc.
- Link di panel membuka doc yang benar.
