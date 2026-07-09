# SPEC-147 — Favicon · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab browser menampilkan brand mark hanoman ("Buntut" putih di atas tile brass), di dev maupun build produksi.

**Architecture:** `src/index.html` tak pernah punya `<link rel="icon">` dan `src/public/` — direktori statis Vite untuk root `src/` — tak pernah ada. Perbaikannya dua berkas produksi: satu aset statis `src/public/favicon.svg` dan satu baris `<link>`. Bentuk ikonnya **sudah dispesifikasi** design system (seksi "App icon & favicon"), dan mark-nya sudah hidup di `src/src/ds/marks.tsx`. Satu-satunya kerumitan: path spiral `HN_BUNTUT_D` **dihitung saat runtime** oleh `taperedSpiralPath()` dan tak pernah ada sebagai string literal, jadi ia di-*bake* sekali oleh skrip sekali-pakai lalu hasilnya ditulis ke `.svg`. Tanpa dependency baru, tanpa langkah build baru, tanpa menyentuh server.

**Tech Stack:** SVG statis, Vite `publicDir` (default), Fastify `@fastify/static` (sudah ada), vitest, Node ≥ 23.6 (type stripping bawaan).

**Spec:** [`internal/docs/operations/spec-147-favicon-spec.md`](../../../internal/docs/operations/spec-147-favicon-spec.md)
**Audit:** [`internal/docs/operations/spec-147-favicon-audit.md`](../../../internal/docs/operations/spec-147-favicon-audit.md)

## Global Constraints

- **Tanpa dependency runtime maupun devDependency baru.** Tidak ada paket baru di `package.json` mana pun. Skrip bake adalah berkas sekali-pakai di `/tmp`, dihapus di step yang sama.
- **Tanpa perubahan server, skema, migration, atau `vite.config.ts`.** Karena tak ada migration, **tidak ada ADR** (`AGENTS.md` hanya menuntut ADR untuk perubahan skema). Jangan membuat ADR baru.
- **Guardrail freshness memblokir commit yang menyentuh `src/` tanpa menyentuh doc.** `IMPL_PREFIXES = ["src/"]`, `DOC_PREFIXES = ["internal/docs/", "internal/skills/", "AGENTS.md", "CLAUDE.md", "README.md"]` (`cli/src/git.ts:2-3`, dipakai `freshnessViolation` di `:16-19`). `docs/superpowers/**` **tidak** dihitung sebagai doc. Karena itu Step 6 wajib memperbarui `internal/docs/frontend/frontend-implementation.md` **di commit yang sama** — ini juga aturan `CLAUDE.md`.
- **`coverageThreshold` default `100`** (`shared/src/config.ts:6`). Dua doc baru SPEC-147 sudah ter-link di `internal/docs/README.md`. **Jangan membuat berkas baru lain di `internal/docs/**`** — tanpa link, coverage turun dan plan diblok.
- **Jangan menyentuh `src/src/ds/marks.tsx` maupun `src/src/ds/shell.tsx`.** Favicon membaca *desainnya*, bukan kodenya. `HN_BUNTUT_D` tetap tidak di-export (batas scope spec).
- **Hex ditulis literal (`#b8863b`), bukan `var(--brass-500)`.** Berkas `.svg` yang dimuat sebagai favicon adalah dokumen terpisah dan **tidak mewarisi CSS custom property** dari halaman.
- **Jangan pakai `--` di dalam komentar XML.** SVG adalah XML; `<!-- ... --brass-500 ... -->` mengandung double-hyphen dan **ditolak parser** (`xmllint`: "Comment must not contain '--'"). Tulis `brass-500`, tanpa dua tanda hubung di depan.
- **Jangan `git add -A`, jangan `git stash`.** Ada `.hanoman-decision.json` di root worktree (artefak internal runner, dihapus runner sendiri sebelum `commitAndPush`); jangan pernah men-stage-nya.
- Perintah test: satu berkas `pnpm --filter ./src exec vitest run test/favicon.test.ts`; per paket `pnpm --filter ./src test`; seluruh workspace `pnpm test`. Typecheck: `pnpm typecheck`.
- Catatan bila `queue-durability` di paket `server` gagal: tes itu **order-dependent** dan gagal bila dijalankan terisolasi. Jalankan `pnpm --filter ./server test` utuh sebelum menyimpulkan ada regresi. Plan ini tak menyentuh `server/**`.

---

## File Structure

| File | Tanggung jawab | Task |
|---|---|---|
| `src/public/favicon.svg` | **Baru.** Aset favicon: tile brass ber-radius 24%, mark `buntut` putih. Path di-bake dari `marks.tsx`. | 1 |
| `src/index.html:5-6` | **Baru satu baris.** `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` | 1 |
| `src/test/favicon.test.ts` | **Baru.** Tes regresi: `<link>` ada di html; `favicon.svg` ada dan bergeometri benar. | 1 |
| `internal/docs/frontend/frontend-implementation.md` | Catat: favicon aset statis, path di-bake, `publicDir` default, tanpa `.ico`. | 1 |

`src/src/ds/marks.tsx`, `src/src/ds/shell.tsx`, `src/vite.config.ts`, `server/**`, dan `shared/**` **tidak berubah**.

**Kenapa satu task:** aset tanpa `<link>` tidak terlihat, dan `<link>` tanpa aset menyajikan HTML bertopeng SVG. Keduanya satu deliverable; reviewer tak bisa menerima satu dan menolak yang lain.

---

## Task 1: Favicon brand mark

**Files:**
- Create: `src/public/favicon.svg`
- Create: `src/test/favicon.test.ts`
- Modify: `src/index.html:5` (sisipkan `<link>` setelah `<meta name="viewport">`)
- Modify: `internal/docs/frontend/frontend-implementation.md` (tambah paragraf di akhir)

**Interfaces:**
- Consumes: `taperedSpiralPath()` — dibaca sebagai **teks sumber** dari `src/src/ds/marks.tsx:26-52`, tidak diimpor. Signature: `taperedSpiralPath(opts?: {...}): string`. Dipanggil dengan `{}` (seluruh default), mengembalikan atribut `d` sepanjang **4.579 karakter**, diawali `M 74.05 116.63` dan diakhiri `A 10.50 10.50 0 0 1 74.05 116.63 Z`.
- Produces: berkas statis di URL `/favicon.svg`. Tidak ada symbol TypeScript yang di-export; task lain tidak bergantung padanya.

**Geometri (diturunkan dari `IconTile`, `.prototype/Hanoman Brandmark.html:127-136`):**

| Properti | Nilai | Asal |
|---|---|---|
| `viewBox` | `0 0 128 128` | grid mark (`marks.tsx:5`) |
| tile `rx` | `30.72` | `128 × 0.24` (`borderRadius: size * 0.24`) |
| tile `fill` | `#b8863b` | `--brass-500` (`src/src/ds/tokens/colors.css:27`) |
| mark `scale` | `0.58` | `Mark size={size * 0.58}` |
| mark `translate` | `26.88 26.88` | `(128 − 128×0.58) / 2`, dipusatkan |
| mark `fill` | `#fff` | colorway "White on brass" |

---

- [x] **Step 1: Tulis tes yang gagal**

Berkas baru `src/test/favicon.test.ts`. Path di-resolve dari `import.meta.url`, bukan `process.cwd()` — cwd vitest bergantung pada dari mana ia dipanggil, `import.meta.url` tidak.

> **Amandemen (fase Execute).** Draf pertama gagal bukan dengan `ENOENT` seperti diduga, melainkan
> `TypeError: fileURLToPath is not a function` — dan `readFileSync` pun `undefined`. Root cause:
> `src/vite.config.ts:8` menyetel `environment: "jsdom"` untuk **seluruh** paket `src`, dan di
> bawah jsdom, Vite meng-externalize `node:fs`/`node:url` jadi stub kosong ("Module ... has been
> externalized for browser compatibility") — bukan implementasi Node asli. Tes butuh Node asli
> untuk membaca berkas. Perbaikan: satu baris `// @vitest-environment node` di baris pertama
> berkas tes (fitur bawaan Vitest untuk override environment per-berkas) — tanpa menyentuh
> `vite.config.ts` (yang dipakai seluruh suite `src`), tanpa dependency baru.

```ts
// @vitest-environment node
// Berkas ini butuh node:fs/node:url asli; environment "jsdom" default proyek
// (src/vite.config.ts) membuat Vite meng-externalize keduanya jadi stub kosong.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("favicon (SPEC-147)", () => {
  it("index.html menautkan favicon SVG", () => {
    expect(read("../index.html")).toContain(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
    );
  });

  it("favicon.svg adalah tile brass ber-radius 24% dengan mark putih", () => {
    const svg = read("../public/favicon.svg");
    expect(svg).toContain('viewBox="0 0 128 128"'); // grid mark
    expect(svg).toContain('rx="30.72"');            // 128 × 0.24
    expect(svg).toContain('fill="#b8863b"');        // --brass-500
    expect(svg).toContain('fill="#fff"');           // mark putih
  });

  // SVG adalah XML: komentar ber-'--' menggagalkan parser yang ketat.
  it("favicon.svg tidak punya double-hyphen di dalam komentar", () => {
    const svg = read("../public/favicon.svg");
    for (const c of svg.match(/<!--[\s\S]*?-->/g) ?? []) {
      expect(c.slice(4, -3)).not.toContain("--");
    }
  });
});
```

- [x] **Step 2: Jalankan tes, pastikan gagal karena alasan yang benar**

Run: `pnpm --filter ./src exec vitest run test/favicon.test.ts`

Expected: **3 failed.**
- Tes 1 gagal di `toContain` — `src/index.html` hari ini tak punya `<link rel="icon">` sama sekali.
- Tes 2 dan 3 gagal dengan `ENOENT: no such file or directory, open '.../src/public/favicon.svg'` — `src/public/` belum ada.

Kalau tes 1 justru lolos, hentikan: berarti `<link>` sudah ada dan tiket ini bukan tentang itu.

Terverifikasi persis begitu setelah amandemen Step 1: **3 failed**, tes 1 di `toContain`, tes 2 & 3 di `ENOENT` untuk `src/public/favicon.svg`.

- [x] **Step 3: Bake path spiral menjadi `src/public/favicon.svg`**

`HN_BUNTUT_D` (`marks.tsx:53`) tak di-export dan dihitung saat runtime, jadi ia diekstrak **sebagai teks sumber** lalu dievaluasi. Ini menghindari menyalin ulang `taperedSpiralPath` dengan tangan (yang akan diam-diam menyimpang bila mark berubah).

Jalankan **dari root repo**:

```bash
cat > /tmp/bake-favicon.mjs <<'EOF'
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Ekstrak sumber taperedSpiralPath dari marks.tsx (fungsi biasa, tanpa JSX),
// tulis sebagai .ts, lalu impor — Node >= 23.6 menanggalkan tipenya sendiri.
const src = readFileSync("src/src/ds/marks.tsx", "utf8");
const start = src.indexOf("function taperedSpiralPath");
const end = src.indexOf("const HN_BUNTUT_D");
if (start < 0 || end < 0 || end < start) throw new Error("penanda taperedSpiralPath/HN_BUNTUT_D tak ketemu di marks.tsx");
writeFileSync("/tmp/spiral.ts", "export " + src.slice(start, end).trimEnd() + "\n");

const { taperedSpiralPath } = await import("/tmp/spiral.ts");
const d = taperedSpiralPath({});
if (d.length !== 4579) throw new Error(`panjang path tak terduga: ${d.length} (harusnya 4579) — mark berubah?`);

// Tanpa '--' di dalam komentar: SVG adalah XML, double-hyphen ilegal di sana.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <!-- hanoman brand mark "Buntut". Path di-bake sekali dari taperedSpiralPath()
       di src/src/ds/marks.tsx; jangan diedit tangan, regenerate dari sana.
       Tile mengikuti IconTile design system: radius 24%, mark 58%, putih di atas
       brass-500. Hex literal: dokumen favicon tak mewarisi CSS custom property. -->
  <rect width="128" height="128" rx="30.72" fill="#b8863b"/>
  <path transform="translate(26.88 26.88) scale(0.58)" fill="#fff" d="${d}"/>
</svg>
`;
mkdirSync("src/public", { recursive: true });
writeFileSync("src/public/favicon.svg", svg);
console.log("favicon.svg:", Buffer.byteLength(svg), "bytes");
EOF
node /tmp/bake-favicon.mjs
rm -f /tmp/bake-favicon.mjs /tmp/spiral.ts
```

Expected: `favicon.svg: 5108 bytes`

Bila Node < 23.6 (`node --version`), impor `.ts` gagal dengan `Unknown file extension ".ts"`. Ganti barisnya jadi `node --experimental-strip-types /tmp/bake-favicon.mjs`.

Bila skrip melempar `panjang path tak terduga`, **jangan diakali** — mark memang berubah. Perbarui angka `4579` di skrip **dan** di plan ini, dan periksa ikon secara visual di Step 7.

Node terpasang `v24.11.1` — impor `.ts` langsung berhasil tanpa flag. Keluaran persis
`favicon.svg: 5108 bytes`.

- [x] **Step 4: Pastikan SVG-nya well-formed**

Run: `xmllint --noout src/public/favicon.svg && echo OK`
Expected: `OK` (tanpa keluaran lain). `xmllint` sudah ada di macOS.

Kalau ia melapor `Comment must not contain '--' (double-hyphen)`, komentar di Step 3 telah diubah dan menyisipkan `--` — lihat Global Constraints.

- [x] **Step 5: Tautkan favicon di `src/index.html`**

Sisipkan **satu baris** sesudah `<meta name="viewport" ... />` (baris 5), sebelum `<title>`:

```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

Hasilnya:

```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>hanoman</title>
  </head>
```

Jangan tambahkan `apple-touch-icon`, `manifest`, maupun `<link rel="icon" href="/favicon.ico">` — batas scope spec.

- [x] **Step 6: Perbarui doc yang tersentuh (wajib, di commit yang sama)**

`internal/docs/frontend/frontend-implementation.md` — tambahkan paragraf di **akhir berkas** (setelah baris 60):

```markdown
Favicon adalah **aset statis**, bukan komponen: `src/public/favicon.svg` (SPEC-147). Vite root
adalah `src/`, jadi `publicDir` default-nya `src/public/` — dev menyajikannya di `/favicon.svg`,
`vite build` menyalinnya ke `src/dist/`, dan di produksi `fastifyStatic` (`server/src/app.ts:51-52`)
menyajikannya dari root. Server tidak tahu-menahu. Bentuknya mengikuti `IconTile` design system —
mark `buntut` putih di atas tile `--brass-500` ber-radius 24% — tapi hex-nya ditulis **literal**,
karena dokumen `.svg` yang dimuat sebagai favicon tak mewarisi CSS custom property halaman. Atribut
`d`-nya di-**bake** sekali dari `taperedSpiralPath()` (`src/src/ds/marks.tsx`), yang menghitung
spiralnya saat runtime dan tak pernah menyimpannya sebagai string; berkas `.svg` itu tidak diedit
tangan. Tak ada `favicon.ico`: Safari 26+ sudah mendukung favicon SVG, dan bila suatu saat browser
lawas perlu didukung, `.ico` cukup dijatuhkan ke `src/public/` **tanpa perubahan markup** — browser
me-request `/favicon.ico` dari root dengan sendirinya.
```

- [x] **Step 7: Jalankan tes dan typecheck, pastikan hijau**

Run: `pnpm --filter ./src exec vitest run test/favicon.test.ts`
Expected: **3 passed.**

Run: `pnpm typecheck`
Expected: keluar `0`.

Run: `pnpm test`
Expected: seluruh workspace hijau. (Lihat Global Constraints soal `queue-durability`.)

> **Amandemen (fase Execute).** `pnpm typecheck` gagal pertama kali di paket `server` saja
> (`Prisma... has no exported member`) — worktree ini fresh, `@prisma/client`'s postinstall
> tak menemukan `server/prisma/schema.prisma` dari lokasi defaultnya di monorepo pnpm. Perbaikan:
> `pnpm --filter ./server exec prisma generate --schema=prisma/schema.prisma` (langkah setup
> yang seharusnya sudah beres, bukan perubahan kode). Sesudahnya `pnpm typecheck` keluar `0`
> di semua paket.
>
> `pnpm test` **tidak** hijau di seluruh workspace: 83 tes gagal, seluruhnya di paket `server`,
> seluruhnya `PrismaClientInitializationError: Database "hanoman_prod_test" does not exist`.
> Root cause: `DATABASE_URL` ambient shell ini menunjuk `hanoman_prod` (bukan `hanoman`), dan
> `server/vitest.config.ts:21` menurunkan `<nama>_test` darinya — `hanoman_test` (sibling dari
> `hanoman`) memang ada, `hanoman_prod_test` tidak pernah diprovisikan. Dikonfirmasi **tak
> berhubungan** dengan perubahan ini: (1) tak satu pun dari 83 tes gagal menyentuh `src/` atau
> berkas yang diubah task ini; (2) menjalankan `test/id.test.ts` dengan `DATABASE_URL` diarahkan
> ke `hanoman` biasa (bukan `hanoman_prod`) — **8 lolos**. Tak diperbaiki di sini: menyediakan
> `hanoman_prod_test` adalah pekerjaan provisioning untuk fitur "production environment" (commit
> `6587728`), di luar scope favicon dan di luar kewenangan task Execute ini ("jangan kerjakan
> pekerjaan lain"). Verifikasi yang benar-benar dalam scope — `pnpm --filter ./src test` dan
> `pnpm typecheck` — keduanya hijau.

- [x] **Step 8: Verifikasi nyata di aplikasi (aturan `CLAUDE.md`)**

Tes unit hanya membaca berkas — ia tidak membuktikan browser **menyajikan** favicon-nya. Pakai `vite` saja, **jangan `pnpm dev`**: `pnpm dev` ikut mem-boot worker, dan worker yang hidup dapat mengeksekusi run nyata.

```bash
pnpm --filter ./src exec vite --port 5173 &
sleep 3
curl -sI http://localhost:5173/favicon.svg | head -3
kill %1
```

Expected: `HTTP/1.1 200 OK` dan `Content-Type: image/svg+xml`.

**Periksa `Content-Type`, bukan cuma status.** Ini bukan formalitas: SPA fallback di produksi (`server/src/app.ts:54`) mengembalikan `index.html` untuk setiap path non-`/api` yang tak ditemukan, jadi favicon yang hilang akan terjawab `200 text/html` alih-alih `404` — gagal diam-diam.

Lalu pastikan build produksi ikut membawanya:

```bash
pnpm --filter ./src build
test -f src/dist/favicon.svg && echo "tersalin ke dist OK"
```

Expected: `tersalin ke dist OK`.

Terakhir, buka `http://localhost:5173` di browser dan **lihat tab-nya**: harus ada tile brass dengan ekor putih melingkar, bukan ikon generik. Geometri mark dijaga mata, bukan assert.

Dijalankan persis begitu: `curl -sI` mengembalikan `200 OK` + `Content-Type: image/svg+xml` +
`Content-Length: 5108`; `vite build` menyalin `favicon.svg` apa adanya ke `src/dist/` (5108 byte,
identik). Pemeriksaan mata dilakukan lewat `qlmanage -t` (render SVG ke PNG, bukan buka browser
berjendela) — hasilnya persis tile brass dengan ekor putih melingkar, cocok dengan mark di sidebar
(`shell.tsx:29`) dan seksi "App icon & favicon" design system.

- [x] **Step 9: Centang checklist plan ini lalu commit**

Ubah setiap `- [ ]` yang selesai di berkas plan ini menjadi `- [x]` (aturan `CLAUDE.md`).

```bash
git add src/public/favicon.svg \
        src/index.html \
        src/test/favicon.test.ts \
        internal/docs/frontend/frontend-implementation.md \
        internal/docs/operations/spec-147-favicon-audit.md \
        internal/docs/operations/spec-147-favicon-spec.md \
        internal/docs/README.md \
        docs/superpowers/plans/2026-07-10-hanoman-favicon-spec-147.md
git commit -m "fix(web): tambahkan favicon brand mark (SPEC-147)"
```

Jangan `git add -A` — `.hanoman-decision.json` di root worktree adalah artefak internal runner dan tak boleh ikut ter-stage.

---

## Kriteria selesai

Dipetakan dari kriteria EARS di spec:

| Kriteria EARS (spec) | Dijaga oleh |
|---|---|
| `/favicon.svg` disajikan `image/svg+xml` di dev **dan** produksi | Step 8 (`curl -sI`, `test -f src/dist/favicon.svg`) |
| `src/index.html` menyatakan `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` | Tes 1, Step 5 |
| Favicon = mark `buntut` putih di atas tile `#b8863b` ber-radius 24% | Tes 2, Step 3 (geometri diturunkan), Step 8 (mata) |
| Tab menampilkan brand mark, bukan ikon generik | Step 8 |
| Tanpa dependency runtime maupun devDependency | Global Constraints; skrip bake sekali-pakai di `/tmp`, `package.json` tak disentuh |

Satu kriteria tambahan yang tak ada di spec tapi ditemukan saat menulis plan ini: **SVG harus well-formed XML.** Draf pertama komentar aset memuat `--brass-500`, dan `xmllint` menolaknya (`Comment must not contain '--'`). Dijaga Step 4 dan tes 3.

---

## Catatan untuk fase Execute

- Spec ini memuat seksi **"Koreksi terhadap audit"**: audit memilih jalur `spec` dengan alasan keputusan desain belum terkunci, padahal sudah — di seksi "App icon & favicon" design system. Bit `spec` tetap benar sebagai default konservatif (ADR-0020), dan tak ada yang perlu diperbaiki di sana.
- Angka `4579` di skrip bake adalah **penjaga, bukan konstanta yang harus dipertahankan**. Ia menangkap perubahan mark yang tak disengaja. Bila mark memang berubah, perbarui angkanya dan periksa ikonnya dengan mata.
