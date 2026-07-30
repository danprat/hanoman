# Merilis paket npm `hanoman`

Menerbitkan versi baru `hanoman` ke registry npm publik. Mekanismenya **trusted publishing (OIDC)**
lewat `.github/workflows/release.yml` — tak ada token penerbit yang pernah tersimpan di mesin mana
pun. Keputusan & alasannya: [ADR-0087](../adr/0087-distribusi-npm-global-satu-perintah.md),
termasuk amandemen 2026-07-30 yang memindahkan publish dari tangan manusia ke CI.

## Sekali di awal (urutannya mengikat)

Dua mekanisme non-interaktif npm sama-sama mengandaikan paketnya **sudah ada**: GAT hanya bisa
di-scope ke paket yang sudah terbit, dan trusted publisher dikonfigurasi **per paket** di halaman
setelan paket. Jadi versi pertama tak bisa diotomasi.

1. ~~**Terbitkan `0.1.0` sekali secara berautentikasi**~~ — **SUDAH DILAKUKAN 2026-07-30.**
   `hanoman@0.1.0` terbit dari `build-info.sha` `6d1867f`. Publish memerlukan salah satu dari:
   ```sh
   npm profile enable-2fa auth-only   # OTP hanya untuk login/setelan akun, BUKAN untuk publish
   # ATAU: Granular Access Token ber-"bypass 2FA" (kredensial di disk — lihat ADR-0087)
   npm whoami                         # harus membalas nama akun sebelum publish
   pnpm release && cd dist-npm && npm publish --access public
   ```
   `npm publish` **ditolak 403** bila 2FA akun `disabled` **dan** tak ada GAT ber-bypass — npm
   menuntut salah satunya. Cek modenya dengan `npm profile get` (baris `two-factor auth`).
2. **Daftarkan trusted publisher** di npmjs.com → paket `hanoman` → *Trusted publisher* → GitHub
   Actions: organization/user `denameidina`, repository `hanoman`, workflow `release.yml`.
3. **Pasang gerbang manusianya** — ini langkah yang benar-benar menggantikan "manusia mengetik
   `npm publish`": repo Settings → Environments → `release` → **Required reviewers**. Tanpa ini,
   siapa pun (termasuk agen) yang bisa mendorong tag bisa menerbitkan rilis.

## Tiap rilis

```sh
# 1. Bump versi — SATU sumber, di root package.json
npm version 0.2.0 --no-git-tag-version    # atau sunting "version" langsung
# 2. Commit + merge ke main lewat alur biasa
# 3. Dorong tag yang COCOK dengan versi itu
git tag v0.2.0 && git push origin v0.2.0
```

Workflow lalu: memeriksa tag == `version` → `pnpm install --frozen-lockfile` → `pnpm release` →
**memasang tarball hasil rakitan dan menjalankan `hanoman --version`** → `npm publish --provenance`.

Versi hidup di root `package.json` dan ditanam ke `dist/build-info.json` oleh
`scripts/stamp-build.mjs`. **Jangan** menyunting `dist-npm/package.json` — ia di-*generate*
`packageJsonFor()` setiap pack.

## Pagar yang tak bergantung penilaian siapa pun

| Pagar | Kegagalan yang dicegah |
|---|---|
| Trigger hanya tag `v*` | publish tak sengaja dari push biasa ke main |
| Tag harus == `version` root | menerbitkan nomor versi salah — dan nomor terbit **tak bisa dipakai ulang** |
| Tarball dipasang & `hanoman --version` diuji | menerbitkan paket yang tak bisa dijalankan |
| `repository.url` dijaga `cli/test/pack.test.ts` | publish ditolak OIDC/provenance karena URL tak cocok |
| Environment `release` + reviewer | rilis tanpa persetujuan manusia |

`hanoman doctor` **tidak** dipakai di CI: ia menuntut `git`, `tmux`, dan CLI agen yang memang tak
ada di runner, jadi ia akan exit 1 karena alasan yang tak relevan dengan kesehatan paket.

## Kalau publish gagal

- **`repository.url` tak cocok** — trusted publishing & `--provenance` membandingkannya dengan repo
  pembangun **persis**. Nilainya `REPO_URL` di `cli/src/release/pack.ts`; bandingkan dengan
  `git remote get-url origin` (bentuknya `git+<url>`).
- **OIDC ditolak** — periksa `permissions: id-token: write` masih ada, dan nama berkas workflow di
  setelan trusted publisher npm cocok (`release.yml`, bukan path lengkap).
- **npm runner terlalu tua** — workflow menjalankan `npm i -g npm@latest` lebih dulu justru untuk
  ini; trusted publishing menuntut npm yang cukup baru.
- **Versi sudah terbit** — npm menolak menimpa. Bump ke versi berikutnya; jangan mencoba
  `--force`. Unpublish hanya mungkin dalam 72 jam dan **tetap** memblokir nama+versi itu selamanya.
- **`ENEEDAUTH — This command requires you to be logged in`** padahal token baru saja dipasang:
  baris di `~/.npmrc` **wajib** berawalan `//` → `//registry.npmjs.org/:_authToken=…`. Tanpa `//`
  npm tak mengenalinya sebagai kredensial registry, dan pesannya terbaca seperti "token
  salah/kedaluwarsa" padahal tokennya sehat. Periksa bentuknya tanpa membocorkan nilainya:
  `sed 's/\(_authToken=\).*/\1<DISENSOR>/' ~/.npmrc`.
- **`404` / `npm view` gagal tepat sesudah publish sukses** — itu propagasi replika-baca registry,
  bukan publish yang gagal. Terukur ±5 detik. Tunggu, jangan publish ulang.
- **`npm token create` tak bisa membuat GAT di npm 11.6.2** (hanya token klasik
  `--read-only`/`--cidr`), dan `npm i -g npm@latest` menolak jalan di node `v24.11.1` (menuntut
  `^24.15.0`). Sampai node dinaikkan, GAT harus dibuat dari npmjs.com.

## Yang sengaja TIDAK dilakukan

- `pnpm release` **tak pernah** memanggil `npm publish` — tak ada jalur publish dari mesin dev
  (ADR-0087).
- Tak ada Granular Access Token ber-bypass-2FA di mesin mana pun: ia adalah kredensial penerbit di
  berkas yang bisa dibaca proses apa pun di mesin itu, termasuk sesi agen.
- Tak ada publish dari branch — hanya dari tag.
