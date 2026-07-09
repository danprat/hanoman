# SPEC-012 — Runner spawn `claude` CLI langsung (cabut Agent SDK)

## Kenapa
Kontrol penuh atas argv/env per run, tanpa bergantung pada `@anthropic-ai/claude-agent-sdk`,
dan agar run hanoman berjalan **persis** seperti sesi terminal harian: setting user + project +
local, hooks, plugin, dan skill semuanya termuat.

`internal/docs/architecture/stack.md:12` sudah menyebut "Claude Code headless (CLI) + hooks".
SDK-lah yang menyimpang dari dokumen; SPEC ini mengembalikan kode ke janji dokumen.

## Fakta terverifikasi (probe binary asli, bukan asumsi)
SDK `query()` sendiri hanya `spawn()` binary `claude` dengan `--output-format stream-json`,
jadi ini menghapus satu lapis wrapper, bukan mengubah arsitektur.

| Hal | Hasil probe |
|---|---|
| stdin framing | `{"type":"user","message":{"role":"user","content":"…"}}` per baris — sama persis dengan output `SteerQueue.stream()` |
| output | `system` (`init`/`hook_*`/`thinking_tokens`), `assistant`, `result`, `rate_limit_event` |
| `--effort low` + `-p` | diterima |
| PreToolUse deny + `--dangerously-skip-permissions` | deny tetap menang; `rm -rf` dicoba 1×, ditolak, file umpan selamat |
| `--settings` inline + setting user | **merge**, bukan replace |
| multi-turn (steering) | **satu `result` per giliran** |
| `result.total_cost_usd` | kumulatif per sesi |
| `result.usage.*_tokens` | **per giliran** |

## Bug yang ikut ketahuan
`runner/src/sdk.ts:26` menulis `tokensIn = m.usage.input_tokens` (assign). Karena steering
memancarkan satu `result` per giliran dan `usage` bersifat per-giliran, fase `Execute` yang
di-steer hanya melaporkan token giliran **terakhir**. Cost benar (kumulatif → assign tepat).
Bukan regresi porting — perilaku SDK identik karena binary-nya sama — tapi baris itu ditulis
ulang di SPEC ini, jadi diperbaiki sekalian: `+=` untuk token, `=` untuk cost.

## Keputusan desain
- `queryFn` CLI ditulis **sekali** di `runner/` dan dipakai dua call-site (`server`, `cli`),
  yang saat ini menduplikasi `queryFn` **dan** map `THINK`.
- `canUseTool` (callback JS) tidak bisa menyeberang batas proses. Diganti **PreToolUse hook**
  lewat `--settings` inline yang memanggil `hanoman hook pretooluse` — menumpang pola
  `hook stop` yang sudah ada. **Tanpa** MCP server.
- Run memakai **`--dangerously-skip-permissions`**, bukan `--permission-mode acceptEdits`.
  Semantik `canUseTool` lama adalah "izinkan semua kecuali `deniesDangerous`"; run tak
  berpenunggu sehingga tak ada yang menjawab prompt izin, dan `acceptEdits` hanya melonggarkan
  tool edit. Akibatnya PreToolUse hook jadi **satu-satunya gerbang** — karena itu ia diuji
  terhadap binary asli, bukan cuma unit test.
- `--effort` menerima kosakata yang sama dengan `steps[*].effort`, jadi map `THINK` dan
  `RunDeps.effortToThinking` dihapus di kedua paket.
- `--setting-sources user,project,local` ditulis eksplisit (bukan mengandalkan default CLI).
- `includePartialMessages` dibuang: di-set `true` tapi `stream_event` tidak pernah dikonsumsi.
- `systemPrompt: {preset: "claude_code"}` dibuang: itu memang default CLI.
- `--disallowed-tools` tetap dipasang sebagai lapis kedua di samping hook.

## Konsekuensi yang diterima sadar
Memuat setting user berarti `~/.claude/CLAUDE.md` (yang mengimpor RTK.md dan menulis ulang
`git status` → `rtk git status`) serta hook `SessionStart` global ikut aktif di dalam run
otonom. Itu memang tujuannya ("as is seperti sehari-hari"), dengan ongkos: token tambahan per
fase dan perilaku run ikut berubah bila `~/.claude` berubah. Run tidak lagi hermetik.

## Tugas

### 1. Runner: queryFn berbasis spawn
- [x] `runner/src/claude-cli.ts` — `buildArgs()` murni + `makeClaudeCliQuery({bin, guardCommand})`
- [x] Exit non-nol **tanpa** `result` → lempar error legible (stderr dipotong 500 char)
- [x] Abort → `SIGTERM`
- [x] `runner/test/claude-cli.test.ts` — uji `buildArgs` (satu check runnable)

### 2. Runner: rapikan fase
- [x] `sdk.ts` → `phase.ts` (nama `sdk` berbohong setelah SDK dicabut); `sdk.test.ts` → `phase.test.ts`
- [x] Token `+=`, cost `=`; buang `includePartialMessages`/`systemPrompt`/`canUseTool`
- [x] `maxThinkingTokens` → `effort`
- [x] `run.ts` + `RunDeps`: buang `effortToThinking`, teruskan `step.effort`
- [x] `safety.ts`: buang `canUseTool` (bentuk khusus SDK), pertahankan `deniesDangerous`
- [x] `index.ts`: export `claude-cli`, ganti `./sdk` → `./phase`

### 3. CLI: adapter guardrail
- [x] `cli/src/commands/hook-pretooluse.ts` — pakai ulang `deniesDangerous`
- [x] `cli/src/router.ts` — rute + baris HELP

### 4. Cabut SDK dari dua call-site
- [x] `server/src/runner/deps.ts` — `makeClaudeCliQuery`, hapus `THINK`
- [x] `cli/src/commands/_deps.ts` — idem
- [x] `server/package.json` + `cli/package.json` — buang dependency & flag `--external`
- [x] `runner/test/run.test.ts`, `server/test/worker.test.ts` — buang `effortToThinking`

### 5. Dokumentasi (Source of Truth)
- [x] ADR `internal/docs/adr/0010-runner-spawns-claude-cli.md`
- [x] `internal/docs/architecture/stack.md` — guardrail via PreToolUse, setting-sources

### 6. Verifikasi nyata
- [x] `pnpm -r typecheck` hijau (5 paket); runner 18 ✓, cli 26 ✓, server 123 ✓
      (1 gagal: flake `queue-durability` yang sudah dikenal, tak menyentuh `prodDeps`)
- [x] `hanoman hook pretooluse` diuji langsung: `rm -rf` dan `git push --force upstream main`
      ditolak; `pnpm test` dan tool non-Bash lolos
- [x] Guardrail diuji **di dalam sesi `claude` sungguhan** dengan `--dangerously-skip-permissions`:
      1 percobaan `Bash(rm -rf …)`, deny menang, file umpan selamat
- [x] `runner/test/live-smoke.test.ts` diaktifkan (`HANOMAN_LIVE=1`) — dulu stub `expect(true)`;
      sekarang benar-benar men-spawn `claude` dan lulus
- [x] Spawn ENOENT gagal legible (dulu `'error'` tanpa listener → uncaught, worker mati)
