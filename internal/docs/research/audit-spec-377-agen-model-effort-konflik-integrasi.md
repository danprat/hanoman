# Audit SPEC-377 — Rebase/merge yang konflik memakai agen default, bukan setelan

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major · **Tanggal:** 2026-07-29
**Metode:** `superpowers:systematic-debugging`

## Keluhan

> "saat ini ketika conflict terjadi masih menggunakan default. dan itu jadi tidak flexible"
> Ekspektasi: "ketika rebase / merge conflict terjadi solve menggunakan agent menggunakan
> model & effort yang di set dari setting."

## Akar masalah

Rebase/merge dijalankan deterministik di worktree isolasi (`services/integrate.ts`, ADR-0031/0053).
Bila git menolak dengan konflik, worktree ditinggalkan dan **route** yang men-spawn sesi agen untuk
membereskannya. Ada **tiga** route yang melakukannya:

| Route | Kelahiran sesi | Status |
|---|---|---|
| `POST /terminal/sessions/:id/integrate` (PRD, `routes/terminal.ts`) | `sessionAgentDefaults()` + `ensureCodexTrust` | benar |
| `POST /specs/:id/integrate` (backlog, `routes/specs.ts`) | `sessionModel()`, tanpa `agent` | **salah** |
| `POST /projects/:id/git/{merge,rebase,pull,drop}` (git graph, `finishGraphOp` di `routes/ide.ts`) | `sessionModel()`, tanpa `agent` | **salah** |

`sessionModel()` (`services/settings.ts:57`) sengaja **khusus claude** — ia mengembalikan blok
`Setting.model`/`Setting.effort` saja dan tak pernah melihat `Setting.agent` maupun `Setting.codex`.
Karena kedua route itu juga tak meneruskan `agent`, `createSession` jatuh ke baris terakhirnya:

```ts
const agent: Agent = opts.agent ?? "claude";   // services/pty.ts:259
```

Jadi sesi penyelesai konflik **selalu** lahir sebagai claude dengan model/effort dari blok claude —
apa pun yang dipilih operator di Settings. Inilah "default" yang dikeluhkan.

Ini adalah **drift**, bukan keputusan: SPEC-338/ADR-0074 memindahkan seluruh kelahiran sesi ke
`sessionAgentDefaults()` dan memperbarui delapan call site di `routes/terminal.ts` + jalur
`services/session-launch.ts`, tetapi melewatkan `routes/specs.ts` dan `routes/ide.ts`.

Kartu **Agen sesi** di Settings (`SettingsScreen.tsx:529`) bahkan menjanjikan sebaliknya secara
harfiah: *"Perilaku sesi identik — worktree terisolasi, fase, stage, review, **integrate**. Yang
berbeda hanya CLI-nya."* Kontrak yang tertulis di UI itu tidak dipenuhi jalur backlog & git graph.

### Akibat berlapis saat `Setting.agent = "codex"`

1. **Agen salah** — `claude` yang dijalankan, bukan `codex`.
2. **Model & effort salah** — diambil dari blok claude, jadi `Setting.codex.model`/`.effort` yang
   dituning operator tak pernah dipakai untuk konflik.
3. **Gerbang trust codex tak dibuka** — `ensureCodexTrust(repoDir)` tak dipanggil di kedua route.
   Andai agennya sudah benar pun, sesi codex akan mentok di layar *"Do you trust the contents of
   this directory?"* tanpa ada manusia di pane yang bisa menjawab (SPEC-338).
4. **Koersi effort codex tak berlaku** — `coerceCodexEffort` di `createSession` hanya menyala untuk
   `agent === "codex"`, jadi titik cekik SPEC-339 terlewat di jalur ini.

## Reproduksi (terukur)

Test `server/test/integrate-conflict-agent.test.ts` menyetel
`Setting = { agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } }`, memicu konflik
merge nyata, lalu membaca **argv pane tmux** (pola `session-launch.test.ts` — di situlah pilihan
agen benar-benar mewujud). Hasil sebelum perbaikan, tiga jalur seragam:

```
--model claude-opus-5 --effort xhigh --dangerously-skip-permissions --settings {"hooks":{}}
```

Yang seharusnya:

```
-m gpt-5.6-terra -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust …
```

`claude-opus-5`/`xhigh` di situ adalah `DEFAULT_SETTING`, bukan nilai tersimpan — persis "masih
menggunakan default".

**Kontrol negatif yang penting:** dengan `agent: "claude"` dan `model: "claude-sonnet-5"`,
`effort: "medium"`, argv-nya **sudah benar** (`--model claude-sonnet-5 --effort medium`). Jadi blok
claude memang dibaca dari Setting; yang hilang hanya percabangan agen. Ini menjelaskan mengapa bug
ini tak terlihat sampai operator memindahkan agen default ke codex.

## Keputusan pasca-Audit

Temuan berconfidence tinggi (reproduksi deterministik + argv terbaca), akar masalahnya satu
pemanggilan helper yang salah di dua berkas, dan perbaikannya persis menyalin pola yang **sudah
teruji** di `routes/terminal.ts`. Tanpa perubahan skema, migration, kontrak API, maupun ADR baru —
ini justru **memulihkan** ADR-0074 di dua call site yang terlewat. **Spec dan Plan dilewati**
(ADR-0020/0040); dokumen ini menjadi doc-of-record.

## Perbaikan

1. `routes/specs.ts` — `sessionModel()` → `sessionAgentDefaults()`, teruskan `agent` ke
   `createSession`, panggil `ensureCodexTrust(repoDir)` saat agennya codex.
2. `routes/ide.ts` — sama, di `finishGraphOp` (menutup merge · rebase · pull · drop sekaligus).
   `finishGraphOp` menerima `repoDir` dari pemanggil; keempatnya sudah memilikinya di scope.
3. Regression test argv untuk ketiga jalur + kontrol negatif claude.

Kalimat pada `IntegrateDialog` ("sesi claude membereskannya") ikut dinetralkan menjadi "sesi agen",
karena agennya kini mengikuti setelan.

## Di luar skop (tercatat, sengaja tak diperbaiki)

`POST /vps/:id/session` (`routes/vps.ts:237`) memakai `sessionModel()` dengan drift yang sama, tapi
ia bukan sesi penyelesai konflik rebase/merge dan bukan bagian dari keluhan ini. Dicatat di sini
sebagai kandidat tindak lanjut agar `sessionModel()` akhirnya bisa dipensiunkan.

Picker agen/model/effort **per operasi integrasi** (cermin `StartSessionModal`) juga tidak dikerjakan:
ekspektasi yang tertulis adalah "yang di set dari setting", dan itu terpenuhi tanpa mengubah bentuk
body `POST /specs/:id/integrate`. Bila kelak diinginkan, itu fitur baru dengan kontrak API baru.
