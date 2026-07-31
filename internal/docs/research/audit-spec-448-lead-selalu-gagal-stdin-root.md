# Audit SPEC-448 — hanoman-lead selalu gagal: tak ada jawaban, tak ada keputusan

- **Sumber**: QA · prioritas tinggi · severity `critical`
- **Status**: akar masalah ditemukan & terukur; Spec/Plan **skipped** (diff kecil, dua akar jelas, tanpa ADR/skema/endpoint baru)
- **Doc-of-record**: berkas ini (ADR-0040 · jalur cepat qa)
- **Retensi**: berumur (ADR-0083) — dihapus berikut entri indexnya begitu perbaikannya tuntas & ter-merge

## Keluhan

Setiap permintaan putusan ke hanoman-lead berakhir `gagal`, tanpa jawaban, dengan galat:

```
lead claude gagal: Warning: no stdin data received in 3s, proceeding without it. If piping from a
slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

## Ringkasan temuan

Dua cacat **independen**, keduanya hidup di `server/src/services/lead/brain.ts` — **titik spawn agen
kedua di hanoman, satu-satunya di luar `server/src/services/pty.ts`**, dan sampai audit ini **tanpa
satu pun test**. Itulah yang menyatukan keduanya: setiap pelajaran yang sudah dibayar mahal di
`pty.ts` harus dibayar ulang di sini, karena tak ada yang menjaga bahwa keduanya sepakat.

| # | Cacat | Akibat |
|---|---|---|
| **A** | `execFile` memberi anak pipa stdin yang **tak pernah ditutup**; `claude -p` membaca stdin sebagai sumber prompt alternatif dan menunggunya 3 detik | 3 detik anggaran lead terbakar tiap panggilan + peringatan mengotori stderr. Terukur: pada anggaran yang sama, stdin terbuka = **nol keluaran**, stdin ditutup = **jawaban benar** |
| **B** | Gerbang root claude (`IS_SANDBOX=1`) dibuka SPEC-403, tapi **hanya di `pty.ts`** | Di instance yang servernya jalan sebagai root — yakni **konfigurasi deploy resmi** — claude `exit(1)` sebelum berpikir. Lead **tak pernah** bisa memutuskan di sana |

Keluhan operator ("selalu gagal, tak ada jawaban") adalah B. A adalah cacat kedua yang tersingkap
oleh baris pertama pesan galat yang sama, dan ia **tetap merugikan di mesin non-root**.

---

## A · stdin yang tak pernah ditutup

### Mekanisme

`brain.ts:68` memakai `execFile`. Node **tidak** meneruskan opsi `stdio` untuk `execFile` — ia selalu
men-spawn anak dengan `stdio: ["pipe","pipe","pipe"]` — dan tak pernah memanggil `stdin.end()`.
Anak karena itu melihat pipa yang **hidup tapi bisu**: bukan TTY, bukan `/dev/null`, tak pernah EOF.

Terukur langsung (probe Node, anak melaporkan sendiri dari dalam prosesnya):

```
child.stdin ada? true  destroyed? false
execFile default → TIDAK ADA EOF setelah 3000 ms (isTTY: undefined)
```

Di sisi claude, `getInputPrompt` menunggu pipa itu lewat `HBr(process.stdin, 3000)` — yang kembali
seketika hanya bila stream sudah `readableEnded`/`destroyed` atau memancarkan `end`/`close`, dan
selain itu **menunggu penuh 3000 ms** lalu memperingatkan:

```js
let o = await HBr(process.stdin, 3000);
if (o) i$("Warning: no stdin data received in 3s, …")
```

### Bukti in-vivo — ini bukan sekadar kosmetik

`claude` 2.1.220 asli, prompt sama, anggaran sama (6000 ms), satu-satunya variabel: `stdin.end()`.

| | stdin **dibiarkan terbuka** (kode hari ini) | stdin **ditutup** (perbaikan) |
|---|---|---|
| durasi | 6551 ms (dibunuh saat batas waktu) | **3554 ms** |
| peringatan stdin | **ya** | tidak |
| stdout | **`""` — kosong** | **`ok`** |

Tiga detik yang dihabiskan menunggu pipa yang takkan pernah mengirim apa pun adalah selisih antara
**ada jawaban** dan **tak ada jawaban**. Ini persis kelas kegagalan yang didiagnosis SPEC-432
(agen berbatas waktu yang tak sanggup selesai dalam anggarannya) — di sana obatnya memberi tahu agen
anggarannya; di sini seperempat sampai separuh anggaran itu hilang **sebelum agen mulai berpikir**.

Efek kedua yang menyesatkan: peringatan itu mendarat di **stderr**, dan `think()` menyusun pesan
galatnya dari `stderr` (`brain.ts:74`). Sebab yang sebenarnya (baris root/sudo) karena itu terdorong
ke baris **kedua**, di belakang peringatan yang bukan penyebab apa pun — dan itulah kenapa laporan
QA membaca gejalanya sebagai "prompt lead tidak sampai ke stdin". Prompt lead memang **tidak** lewat
stdin dan tak seharusnya lewat: ia argumen positional (`leadArgv`), sama seperti sesi pekerja
(SPEC-223).

---

## B · gerbang root: perbaikan yang sudah ada, di titik spawn yang salah

### Mekanisme

`claude` menolak bypass permission saat uid 0. Dari biner 2.1.220 sendiri:

```js
function TIc(){ return typeof process.getuid==="function" && process.getuid()===0
                && process.env.IS_SANDBOX!=="1" && !Z.CLAUDE_CODE_BUBBLEWRAP }
…
if (m9.isRootOutsideDeliberateSandbox())
  console.error("--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons"),
  process.exit(1)
```

`exit(1)` terjadi **sebelum** satu token pun diproses: lead keluar tanpa keluaran, `think()` menolak,
`decide()` menulis baris jejak `gagal`. Tak ada keputusan yang pernah lahir.

### Kenapa ini lolos

Gerbang itu punya jalan keluar resmi — `IS_SANDBOX=1` — dan hanoman **sudah memakainya**.
`server/src/services/pty.ts:83`:

```ts
export const rootBypassEnv = (uid = process.getuid?.()): Record<string, string> =>
  uid === 0 ? { IS_SANDBOX: "1" } : {};
```

komentar di atasnya menyebut persis kasus ini: *"Ini persis kasus VPS: hanoman dijalankan sebagai
root, jadi SEMUA sesi claude mati saat lahir."*

Yang tak terjadi adalah pewarisannya. Kedua perubahan lahir **di hari yang sama, di worktree
paralel**, dan tak pernah saling melihat:

```
a16465e 2026-07-31 feat(409): hanoman-lead — agen pemimpin di atas agen (ADR-0091)
e5c73ac 2026-07-31 fix(pty): sesi claude mati seketika saat hanoman jalan sebagai root
git merge-base --is-ancestor e5c73ac a16465e → TIDAK
```

`brain.ts` men-spawn agen **tanpa opsi `env` sama sekali**, jadi ia mewarisi `process.env` apa adanya
— dan di server root `IS_SANDBOX` tak ada di sana.

### Kenapa ini pasti kena di produksi, bukan mungkin

Tiga fakta bertemu, ketiganya default resmi:

1. `internal/docs/operations/deploy-vps.md:126` → **`User=root`**.
2. Agen default = **claude** (`shared/src/entities.ts:260`, `zAgent.default("claude")`), dan
   `leadAgentDefaults()` jatuh ke `sessionAgentDefaults()` selama blok `lead.engine` mati (default).
3. Sesi pekerja di VPS **selamat** (lewat `pty.ts`), jadi tak ada gejala lain yang menunjuk ke root
   — hanya lead yang mati, dan matinya konsisten 100%.

Codex tidak terkena: binernya (0.146.0) tak punya string `root/sudo` maupun `IS_SANDBOX`. Itu sebab
`pty.ts` memasang env ini **hanya untuk claude**, dan perbaikan ini mengikuti aturan yang sama.

---

## Kenapa tak ada test yang menangkapnya

`lead-decide.test.ts` menyuntik `think` sebagai stub (`think: async () => raw`) — benar untuk menguji
otaknya, tapi berarti `brain.ts` **tak pernah dieksekusi test mana pun**. Tak ada `lead-brain.test.ts`.
Bandingkan `pty.ts`, yang gerbang root-nya dijaga dua test (`pty.test.ts:89`, `:96`).

Fixture yang ada pun tak bisa dipakai apa adanya: `fake-claude.sh` diakhiri `exec cat` karena ia
mensimulasikan **TUI di pane tmux** yang memang harus tetap hidup. Agen one-shot lead butuh
kebalikannya — proses yang **keluar sendiri** — sehingga sukses bisa dibedakan dari kehabisan waktu.

## Perbaikan

Tanpa ADR (ADR-0091 **ditegakkan**, bukan diamandemen; ADR-0037 utuh; keputusan SPEC-403 diperluas ke
titik spawn kedua yang seharusnya sudah tercakup). Tanpa migration, endpoint, knob, atau perubahan
kontrak API.

1. **`think()` menutup stdin anak** begitu proses lahir (`child.stdin?.end()`) — untuk **kedua** agen.
   Anak melihat EOF seketika; tak ada lagi 3 detik yang hilang dan tak ada lagi peringatan yang
   menyamar sebagai penyebab di pesan galat.
2. **`leadEnv(agent, base, uid)`** memasang `rootBypassEnv(uid)` untuk agen **claude** dan meneruskan
   hasilnya ke `execFile`. `rootBypassEnv` **diimpor dari `pty.ts`**, bukan disalin: satu definisi
   tentang bagaimana gerbang root claude dibuka, supaya titik spawn ketiga (bila kelak ada) tak
   mengulang audit ini untuk yang ketiga kali.
3. **`server/test/lead-brain.test.ts`** + fixture `fake-lead-agent.sh` (agen one-shot yang keluar
   sendiri, melaporkan argv · `IS_SANDBOX` · EOF stdin). Sebelum perbaikan: `think()` **kehabisan
   waktu** untuk claude maupun codex — reproduksi cacat A dalam bentuk kecil.

### Gotcha yang mengikat

- **`execFile` mengabaikan opsi `stdio`.** Node meneruskan `cwd`/`env`/`uid`/`shell`/`signal` ke
  `spawn`, **bukan** `stdio` — jadi `stdio: ["ignore", …]` di sana diam-diam tak berefek dan pipanya
  tetap lahir. Satu-satunya jalan adalah menutupnya lewat handle anak yang dikembalikan.
- **Fixture agen lead wajib keluar sendiri.** Memakai `fake-claude.sh` (yang `exec cat`) membuat
  setiap test `think()` selalu berakhir "kehabisan waktu" — hijau maupun merah tak terbedakan.
- **`IS_SANDBOX` hanya untuk claude.** Memasangnya untuk codex tak menolong (tak ada gerbangnya) dan
  menyesatkan pembaca berikutnya tentang di mana batas keamanan sebenarnya berada (ADR-0037: isolasi
  worktree, bukan flag).
- **Env pemanggil tak ditimpa jadi berbeda**: `IS_SANDBOX` yang sudah disetel operator tetap menang
  bentuknya, cermin urutan `envPairs` di `pty.ts:324` yang sengaja menaruh gerbang root **sebelum**
  env pemanggil.
