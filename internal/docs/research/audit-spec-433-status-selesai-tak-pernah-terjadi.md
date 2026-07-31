# Audit SPEC-433 — status "Selesai" di terminal tidak pernah terjadi

- Sumber: Finding QA · prioritas tinggi · severity `critical`
- Flow: `qa` (Audit → Spec → Plan → Execute)
- Tanggal: 2026-07-31

## Keluhan

> **Expected:** ketika semua flow sudah di kerjakan harusnya status di terminal menjadi selesai.
> **Actual:** status selesai di terminal tidak pernah terjadi.

## Ringkasan temuan

Keluhannya akurat, dan bukan intermiten: untuk sesi yang berjalan **wajar sampai tuntas**, pil
hijau **"Selesai"** di header sel Terminal **secara struktural tak bisa muncul**.

Sel Terminal hanya punya SATU sumber untuk memutuskan status: `session.exited`, yang diturunkan
dari `#{pane_dead}` milik tmux. `exited` menjawab pertanyaan **"apakah proses agennya sudah
mati?"** — bukan **"apakah pekerjaannya sudah selesai?"**. Agen hanoman adalah **TUI interaktif**
(`claude "$(cat <promptfile>)"` / `codex`, SPEC-223): sesudah menulis baris fase terakhir,
commit, dan push, ia **kembali ke prompt-nya dan menunggu** — pane tetap hidup selamanya sampai
operator menekan Tutup. Jadi pada jalur sukses `pane_dead` **tak pernah** jadi `1`, dan pil yang
digerbangi `session.exited` tak pernah dirender.

Ironisnya server **sudah tahu** jawabannya. `stageForRun(phases, worktree, specId)` — fungsi yang
sama yang dipakai `liveSpecs()` untuk menaikkan `Spec.stage` ke `done` — membaca berkas fase dan
kotak `- [ ]` di plan. Backlog memakainya dan karena itu **bisa** berkata "done". Terminal tak
pernah menerima verdict itu: yang menyeberang lewat WS hanyalah **daftar nama fase** (`{t:"phase",
phases}`) yang dirender `PhaseStrip` sebagai deretan kata, tanpa kesimpulan.

Ini **belahan kedua** dari konflasi yang sama yang ditutup separuhnya oleh SPEC-402. SPEC-402
menetapkan **"pane mati ≠ pekerjaan selesai"** (pane mati berkode ≠ 0 = gagal). Belahan yang
tersisa — **"pekerjaan selesai ≠ pane mati"** — tak pernah ditutup, dan itulah SPEC-433.

## Bukti — keadaan hidup di mesin ini (2026-07-31, ~11:59 UTC)

Tak perlu repro sintetis: dua sesi di mesin ini sedang berada persis di keadaan yang dikeluhkan.

### (A) Berkas fase: seluruh pipeline `qa` sudah tercatat

```
$ cat /Users/…/hanoman/.worktrees/.phases/spec-431
Audit done
Spec skipped
Plan skipped
Execute done

$ cat /Users/…/hanoman/.worktrees/.phases/spec-432
Audit done
Spec skipped
Plan skipped
Execute done
```

`PIPELINES.qa = ["Audit","Spec","Plan","Execute"]` — keempatnya `done`/`skipped`. Tak ada fase
yang tersisa. Pekerjaannya juga benar-benar mendarat: `63dc2f7 fix(spec-431): …` dan
`f0a4972 fix(432): …` ada di git log.

### (B) Pane-nya HIDUP — TUI menganggur di prompt

```
$ tmux -L hanoman list-panes -a -F '#{session_name}|dead=#{pane_dead}|status=#{pane_dead_status}'
hanoman-spec-431|dead=0|status=
hanoman-spec-432|dead=0|status=
hanoman-spec-433|dead=0|status=
hanoman-spec-384|dead=0|status=
hanoman-f06034cb|dead=0|status=
```

`capture-pane` pada `hanoman-spec-431` menunjukkan sesi yang sudah menulis laporan akhirnya lalu
duduk diam di prompt:

```
✻ Churned for 25m 17s
────────────────────────────────────────────────
❯
────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to  · ←…
```

Itulah mekanismenya, terlihat langsung: **agen selesai, TUI tidak keluar.**

### (C) Server sudah menyimpulkan `done` — hanya Terminal yang tak diberi tahu

```
$ sqlite3 ~/.hanoman/hanoman.db "select id, stage from Spec where id in ('SPEC-431','SPEC-432')"
SPEC-431|done
SPEC-432|done
```

`Spec.stage = done` itu **bukan** tulisan tangan operator: ia ditulis `liveSpecs()`
(`services/live-specs.ts:24`) lewat `stageForRun(entry.phases, entry.cwd, s.id)` — write-through
CAS dari overlay stage live. Artinya, atas sesi yang PANE-nya masih hidup, server sudah menjawab
"done" dengan yakin, lengkap dengan gerbang plan `- [ ]`-nya.

Jadi di detik yang sama, atas sesi yang sama:

| Permukaan | Yang ditampilkan | Diturunkan dari |
| --- | --- | --- |
| Backlog | `done` | `stageForRun(phases, worktree, specId)` |
| Terminal (sel) | *(tak ada pil sama sekali)* | `session.exited` ⇐ `#{pane_dead}` |

## Akar masalah

Satu baris, `src/src/screens/TerminalScreen.tsx:536`:

```tsx
{session.exited && (failed
  ? <StatusPill status="failed" size="sm">{`Gagal · exit ${session.exitCode}`}</StatusPill>
  : <StatusPill status="done" size="sm">Selesai</StatusPill>)}
```

Seluruh status sel digerbangi `session.exited`. Rantai faktanya:

1. `pty.ts:143` — `FMT` menarik `#{pane_dead}` dan `#{pane_dead_status}` dari tmux.
2. `pty.ts:165` — `const exited = dead === "1";`
3. `pty.ts:184` — `listSessions()` menyalinnya apa adanya ke `SessionInfo.exited`.
4. `TerminalScreen.tsx:521` — `failed = session.exited && !!session.exitCode`.
5. `TerminalScreen.tsx:536` — pil hanya dirender bila `session.exited`.

Tak ada satu pun titik di rantai itu yang bertanya soal **fase**. Frame fase (`pty.ts:601`
`pollPhases`) memang mengalir ke sel yang sama dan dirender `PhaseStrip`, tapi ia membawa
**daftar nama**, bukan verdict — `PhaseStrip` mencetak `Audit Spec Plan Execute` berwarna dan
berhenti di situ. Sel tak pernah menyimpulkan apa pun dari daftar itu.

Dengan kata lain: **satu-satunya cara pil "Selesai" muncul hari ini adalah sesi yang mati dengan
exit 0** — yaitu agen yang di-`/exit` manual, atau sesi lama sebelum SPEC-402 (`exitCode`
`undefined` → `!!exitCode` false → dilabeli "Selesai"). Jalur sukses normal tak pernah lewat sana.

### Kenapa ini tak tertangkap test

`src/test/terminal-screen.test.tsx` memeriksa persis dua sisi gerbang yang sama:

- `"sesi yang exited menampilkan badge Selesai …"` (baris 150) — `exited: true`
- `"sesi yang masih hidup tak menampilkan badge Selesai"` (baris 160) — `exited: false`

Test kedua itu **mengunci bug-nya sebagai kontrak**: "hidup ⇒ tak ada Selesai". Ia benar untuk
sesi yang masih bekerja, dan salah untuk sesi yang sudah tuntas — perbedaan yang tak pernah
diuji karena `Cell` tak punya masukan fase di test mana pun.

### Kenapa `exited` tak bisa sekadar "diperluas"

Menjadikan `exited` bernilai true saat fase tuntas akan merusak hal-hal yang benar: `exited`
menggerbangi re-attach vs kelahiran ulang (`createSession`, ADR-0084), tombol "Lanjutkan",
`startable` di picker backlog, `liveDecisions()`, penutupan `SessionHistory`, dan peredupan badan
pane. Semua itu memang bertanya **"prosesnya masih hidup?"** dan jawabannya harus tetap apa
adanya dari tmux. Yang kurang adalah **fakta kedua** yang berdiri sendiri di sebelahnya.

## Perbaikan yang dipilih

Kirimkan verdict yang sudah dimiliki server bersama frame fase yang sudah mengalir, lalu render
pil dari situ.

1. `services/session-phases.ts` — dua fungsi baru:
   `phasesComplete(phases)` (murni: setiap fase `done`|`skipped`, dan daftarnya tak kosong) dan
   `sessionComplete(phases, worktree, specId?)` = `phasesComplete` **DAN** `planComplete` untuk
   sesi ber-spec. Gerbang plan itu wajib: berkas fase bisa berkata `Execute done` sementara plan
   masih menyisakan `- [ ]`, dan hanoman menahan backlog di `executing` justru untuk itu
   (ADR-0029). Tanpa gerbang itu kita cuma menukar "tak pernah hijau" dengan "hijau palsu" —
   kelas kesalahan yang sama yang diperbaiki SPEC-402.
2. `services/pty.ts` — frame `{t:"phase", phases}` menjadi `{t:"phase", phases, complete}`,
   diisi `sessionComplete(...)`, dikirim dari **dua** titik yang sudah ada: `pollPhases()` dan
   `attach()` (supaya pil selamat dari refresh/pindah sel).
3. `src/src/screens/TerminalPane.tsx` + `TerminalScreen.tsx` — `onPhases` meneruskan `complete`;
   `Cell` merender `<StatusPill status="done">Selesai</StatusPill>` untuk pane **hidup** yang
   `complete`, dan header ikut memakai `--status-ok-tint`.

Presedennya `SessionInfo.exitCode` (SPEC-402): fakta kecil yang sudah dipegang server dibiarkan
menyeberang ke UI, bukan disimpulkan ulang di klien.

### Tiga jebakan yang mengikat implementasi

1. **Dedup frame fase.** `pollPhases` melewati siaran bila `JSON.stringify(phases)` sama dengan
   tick sebelumnya (`a.lastPhases`) — dan `complete` bisa berubah **tanpa** daftar fase berubah:
   agen menulis `Execute done` (frame terkirim, `complete=false` karena plan masih `- [ ]`), lalu
   mencentang kotak terakhir → daftar fase identik → **tak ada frame** → pil tak pernah muncul.
   Kunci dedup **wajib** memuat `complete`, dan `attach()` harus memakai bentuk kunci yang sama
   persis. Ini bug yang sama bentuknya dengan dedup `services/events.ts` di SPEC-402 (kebenaran
   yang tak pernah dikirim ulang jadi status yang lengket).
2. **`exited` tetap menang.** Pane mati berkode ≠ 0 harus tetap "Gagal · exit n" (SPEC-402),
   bahkan bila fasenya kebetulan lengkap — agen bisa di-SIGTERM sesudah menulis baris terakhir.
   Urutannya: `exited` → `complete` → `awaiting`.
3. **`complete` menang atas `awaiting` (SPEC-196).** Marker keputusan codex **menyala saat sesi
   selesai wajar** — codex tak punya event `Notification`, jadi markernya dipasang di
   `Stop`+`UserPromptSubmit` (ADR-0074). Membiarkan `awaiting` menang berarti mengulang bug yang
   sedang diperbaiki, khusus untuk separuh agen.

Biaya I/O-nya kecil dan berbatas sendiri: `planComplete` (satu `readdirSync` + baca berkas plan
yang cocok) hanya dijalankan **sesudah** `phasesComplete` murni bernilai true — yaitu di ekor
sesi, bukan sepanjang hidupnya.

## Keputusan pasca-Audit (ADR-0040)

**Spec & Plan `skipped`, langsung Execute.** Akar masalahnya tunggal dan terbukti dari keadaan
hidup (bukan dugaan), diff-nya kecil dan terlokalisasi (dua berkas server, dua berkas web),
tanpa perubahan skema, tanpa endpoint baru, tanpa knob baru, dan tanpa membalik keputusan ADR
mana pun — `exited` tetap berarti persis apa yang selalu diartikannya. Dokumen ini menjadi
doc-of-record perbaikannya.

**Tidak** butuh ADR: tak ada keputusan arsitektural yang berubah. Fakta baru (`complete`)
ditempelkan pada kanal yang sudah ada, bukan kanal WS baru (ADR-0039 utuh), dan sumber
kebenaran sesi tetap tmux + berkas fase (ADR-0016/0008).
