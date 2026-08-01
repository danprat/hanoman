# Audit SPEC-472 — hanoman-lead selalu "gagal" mengambil keputusan

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major · **Tanggal:** 2026-08-01
**Metode:** `superpowers:systematic-debugging`

## Keluhan

> "Hanoman lead masih saja failed ambil keputusan kamu bisa cek lognya"
> Diharapkan: hanoman dapat melakukan pengambilan keputusan interaktif.

## Ringkasan temuan

Lead **memang** gagal, dan penyebabnya bukan lead: proses `claude -p` yang ia jalankan ditolak
**401 di panggilan API pertamanya** karena hanoman meneruskan `ANTHROPIC_API_KEY` — sebuah nilai
yang tersimpan di Settings (`RuntimeConfig`) dan **bukan kunci Anthropic** — ke dalam env anaknya.
Claude Code mendahulukan kunci API eksplisit di atas `CLAUDE_CODE_OAUTH_TOKEN`, mencetak
`Invalid API key · Fix external API key`, lalu `exit(1)` dalam ~2–4 detik.

Yang membuat ini menjadi bug **hanoman**, bukan sekadar salah konfigurasi, ada dua:

| # | Cacat | Akibat |
|---|-------|--------|
| A | `brain.ts` menyusun alasan gagal dari `(stderr \|\| err.message)` — **stdout dibuang**, dan `err.message` diawali seluruh argv (prompt ~10 KB) lalu dipotong 500 char | penjelasan CLI (`Invalid API key …`, yang keluar di **stdout**) tak pernah tersimpan; 152 baris jejak berbunyi identik dan **tak memberi satu petunjuk pun** — persis "cek lognya" yang lognya bisu |
| B | `detect.ts` `continue` tanpa menambah penghitung apa pun saat keputusan **gagal** | pagar AC-11 (`maxAutoAnswers`) tak pernah tersentuh → tiap tick 5 detik men-spawn agen lead baru untuk sesi yang sama, **tanpa ujung** |

Akar konfigurasinya (C) di luar kode: nilai `ANTHROPIC_API_KEY` di Settings tidak sah. Sesudah A
diperbaiki, hanoman menuliskannya sendiri di jejak keputusan dan operator bisa membereskannya dari
Settings — itulah bentuk perbaikan yang benar untuk hanoman, karena hanoman tak boleh menebak niat
operator atas kredensialnya sendiri.

## Bukti — (C) kunci API yang menolak

`LeadDecision` di instance prod (`/srv/hanoman-prod/hanoman.db`), 173 baris:

| status | jumlah |
|---|---|
| `gagal` | 152 |
| `berlaku` | 22 |

Kronologi tiga rezim, terbaca dari `substr(reason,-260)`:

| jendela | modus | jumlah |
|---|---|---|
| 2026-07-31 15:44 → 17:48 | `--dangerously-skip-permissions cannot be used with root/sudo privileges` | 108 |
| 2026-07-31 17:48 → 18:41 | **berhasil** | 22 |
| 2026-08-01 00:37 → berjalan | `Command failed: claude -p …` (tanpa keterangan) | 152 |

Rezim pertama sudah tertutup **SPEC-448** (`leadEnv` memakai `rootBypassEnv` dari `pty.ts`;
`e5c73ac` semula hanya menyentuh `pty.ts`) — terbukti di argv anaknya yang kini membawa
`IS_SANDBOX=1`. Rezim ketiga adalah keluhan ini, dan ia **bukan** kambuhnya rezim pertama.

Seluruh bukti di bawah dikumpulkan terhadap instance yang menjalankan **`fbea930` (0.1.9)** —
tip `origin/main` saat audit ini ditulis — dan perbaikannya dikerjakan di atas commit yang sama.

`strace -f -v -e trace=execve` pada proses server (pid 2560993) memperlihatkan env yang benar-benar
diterima anak — **22 var**, satu lebih banyak daripada `/proc/<pid>/environ` (env saat exec):

```
execve("/usr/bin/claude", ["claude", "-p", "--model", "claude-opus-5", "--effort", "xhigh",
       "--dangerously-skip-permissions", "Kamu adalah **hanoman-lead**: …"],
      ["IS_SANDBOX=1", "LANG=C.UTF-8", …, "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-…",
       …, "HANOMAN_WEB_DIR=…", "ANTHROPIC_API_KEY=hZ…"])
```

`ANTHROPIC_API_KEY` **tidak ada** di env systemd. Ia disuntik saat runtime oleh
`services/config-apply.ts` dari baris `RuntimeConfig` (`config-registry.ts`:
`{ key: "ANTHROPIC_API_KEY", category: "credential", inheritEnv: true }`) — nilainya 92 karakter
diawali `hZ…`, sementara kunci Anthropic selalu diawali `sk-ant-`.

Jejak eksekusi anak itu, dari `strace`:

```
2595205 write(8, "Invalid API key \302\267 Fix external API key\n", 40) = 40
2595205 exit_group(1)
```

Transkrip sesi CLI-nya (`~/.claude/projects/-root-erp/22398f35-….jsonl`) menyimpan hal yang sama
sebagai pesan sintetis, dengan `usage` nol di seluruh kolom — permintaan tak pernah diterima:

```json
{"type":"assistant","message":{"model":"<synthetic>",
 "content":[{"type":"text","text":"Invalid API key · Fix external API key"}],
 "usage":{"input_tokens":0,"output_tokens":0, …}}}
```

**Repro terkendali** (matriks empat sel; env, cwd `/root/erp`, biner, dan bentuk argv identik):

| prompt | env | hasil |
|---|---|---|
| sepele | env server apa adanya (`/proc/2560993/environ` + `IS_SANDBOX=1`) | **lulus**, `OK` |
| prompt lead asli 9 856 B (diambil dari transkrip) | env server apa adanya | **lulus** dalam 83 dtk, blok json lengkap |
| prompt lead asli 8 039 B (disusun ulang dari jejak) | env sesi | **lulus** dalam 43 dtk |
| sepele | env server **+ `ANTHROPIC_API_KEY` dari `RuntimeConfig`** | **GAGAL** — 3,8 dtk, exit 1, `stdout="Invalid API key · Fix external API key"`, `stderr=""` |

Sel terakhir mereproduksi prod **persis**: durasi, exit code, isi kedua stream, dan bentuk
`err.message` (`Command failed: …`).

Kenapa sesi interaktif tak ikut mati: `pty.ts` melahirkan sesi lewat **tmux**, dan env tmux server
membeku saat daemon itu lahir — variabel yang disuntik `config-apply` ke `process.env` server tak
pernah sampai ke sana. Hanya lead (`execFile` langsung dari proses server) yang menerimanya.
Sepuluh sesi claude di mesin yang sama berjalan normal sepanjang jendela yang sama.

## Bukti — (A) alasan gagal yang tak bisa dibaca

`server/src/services/lead/brain.ts`:

```ts
reject(new Error(killed
  ? `lead ${o.agent} kehabisan waktu ${o.timeoutMs} ms`
  : `lead ${o.agent} gagal: ${(stderr || err.message).trim().slice(0, 500)}`));
```

Tiga hal berkonspirasi untuk kegagalan ini:

1. **`stdout` tak pernah dilihat.** CLI menaruh penjelasannya di stdout (terukur di repro:
   `stderr=""`), jadi satu-satunya keterangan yang ada dibuang.
2. **`err.message` `execFile` diawali seluruh argv** — `Command failed: <bin> <args…>` — dan
   argumen terakhir adalah prompt lead (9 856 B di prod). Prefix sebelum stderr saja sudah jauh
   melewati 500 char.
3. **`.slice(0, 500)`** karena itu hanya memuat pembuka prompt.

Hasilnya, 152 baris jejak berbunyi sama persis:

```
lead tak menghasilkan keputusan: lead claude gagal: Command failed: claude -p --model
claude-opus-5 --effort xhigh --dangerously-skip-permissions Kamu adalah **hanoman-lead**: tech
lead mesin di atas semua agen yang bekerja di workspace ini.
Kamu MEMUTUSKAN, lalu melapor. …
```

Panjang setiap baris **552 char** — 32 (prefix `decide.ts`) + 19 (prefix `brain.ts`) + 500 potongan
tetap. Nol informasi diagnostik. `journalctl -u hanoman` juga tak memuat apa pun tentang agen lead
(`lead tick:` di jurnal hanya `P1008` SQLite yang tak berhubungan) karena `decide()` memang
menangkap kegagalan `think()` dan menjadikannya baris jejak, bukan `console.error`.

## Bukti — (B) lead men-spawn ulang tanpa ujung

`server/src/services/lead/detect.ts`:

```ts
const row = await deps.decide({ … }, deps.decideDeps);
if (!row || row.status !== "berlaku") { skip("lead tak menghasilkan keputusan yang berlaku"); continue; }
…
answers.set(s.id, (answers.get(s.id) ?? 0) + 1);   // ← hanya tercapai pada jalur SUKSES
```

Pagar AC-11 (`answers.get(id) >= cfg.maxAutoAnswers`, default 3) menghitung **jawaban yang
diberikan**. Keputusan yang gagal tak menambah apa pun, jadi sesi yang keputusannya selalu gagal
tak pernah mendekati pagar itu — `engine.ts` `TICK_MS = 5_000` menjadwalkan percobaan berikutnya
5 detik kemudian, selamanya.

Terukur di prod: tiga sesi (`spec-419`/`420`/`421`) berputar dengan jarak ~2,6 dtk antar-baris dan
~9,6 dtk per sesi — 152 percobaan dalam ±13 menit, satu proses `claude` untuk masing-masing.
`strace` atas proses server menangkap `execve("/usr/bin/claude", …)` yang baru di tiap putaran.
Ini bukan sekadar kebisingan jejak: tiap percobaan membakar kuota langganan yang sama dengan sesi
pekerja (PRD OQ-1).

## Keputusan pasca-audit

**Spec & Plan dilewati** (ADR-0020/0040): akar masalah terbukti dan tereproduksi, dan
perbaikannya lokal di dua berkas lead + test — tanpa skema, migration, endpoint, kontrak API,
maupun ADR baru.

| # | Perbaikan | Berkas |
|---|---|---|
| A | `leadFailureReason()` murni: alasan gagal disusun dari keluaran **anak yang sebenarnya** — **kedua** stream (stderr dulu, lalu stdout), menyebut exit code/sinyal, menyimpan **ekor**; pesan `execFile` yang memuat argv **tak pernah dipakai** | `server/src/services/lead/brain.ts` |
| B | Keputusan **gagal** ikut berpagar per sesi: sesudah `maxAutoAnswers` kegagalan beruntun lead berhenti mencoba (gerbangnya **sebelum** `decide()` — yang mahal adalah panggilannya), menulis satu baris `quality` + notifikasi, lalu menyerahkan sesi ke operator | `server/src/services/lead/detect.ts` |
| C | *(tindakan operator, bukan kode)* bereskan `ANTHROPIC_API_KEY` di Settings → Kredensial. Sesudah (A), hanoman sendiri yang menyebutkannya di jejak | — |

ADR-0091 tetap utuh: tak ada pergeseran permukaan tindakan, pintu keputusan, maupun jejaknya.

### Kenapa KEDUA stream, bukan stderr saja

Rancangan pertama memakai `stderr → stdout` (yang pertama berisi menang). Verifikasi in-vivo
membatalkannya: dengan env server **penuh**, claude menaruh nasihat yang justru paling berguna di
**stderr** dan vonisnya tetap di **stdout** — sementara dengan env ramping (sel keempat matriks di
atas) stderr kosong dan stdout memuat segalanya. Mana yang terbuang **bergantung env**, jadi
membuang salah satunya mengulang bug ini dalam bentuk kecil. Keduanya disimpan, dipisah ` · `.

### Verifikasi in-vivo (biner `claude` sungguhan, nilai `RuntimeConfig` yang sungguhan)

Alasan yang kini tersimpan di jejak — 257 char, menyebut variabelnya, obatnya, **dan** vonisnya:

```
lead claude gagal (exit 1): ⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or
another auth source is set and takes precedence over your claude.ai login · Unset it to load your
organization's connectors · Invalid API key · Fix external API key
```

Bandingkan dengan 152 baris sebelumnya: 552 char, seluruhnya potongan pembuka prompt lead.

## Catatan lintas-temuan

Kelas bugnya lebih luas daripada lead: **`ANTHROPIC_API_KEY` di `RuntimeConfig` hanya sampai ke
anak-anak yang di-`spawn` langsung oleh proses server**, tidak ke sesi tmux — jadi janji
`inheritEnv: true`/`apply: "new-session"` di `config-registry.ts` hari ini hanya berlaku sebagian.
Itu ketidakselarasan nyata, tapi bukan penyebab keluhan ini dan tak disentuh di sini.
