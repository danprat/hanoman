# ADR 0010 — Runner spawn `claude` CLI langsung, bukan Agent SDK

**Status:** sebagian superseded oleh [ADR-0024](0024-sesi-interaktif-menggantikan-run.md) (SPEC-162) — runner headless dicabut, tetapi keputusan "hook PreToolUse adalah satu-satunya gerbang di bawah `--dangerously-skip-permissions`" TETAP BERLAKU dan dipasang di setiap sesi interaktif

## Konteks
Runner memanggil `query()` dari `@anthropic-ai/claude-agent-sdk`. SDK itu sendiri hanya
`spawn()` binary `claude` dengan `--output-format stream-json`, jadi ia adalah lapis pembungkus,
bukan transport tersendiri. Dua akibatnya:

1. Argv dan env tiap run ditentukan SDK, bukan kita.
2. SDK memakai `settingSources: ["project"]`, sehingga run **tidak** memuat setting user,
   hook global, plugin, atau skill — run tidak menyerupai sesi terminal harian, padahal
   `architecture/stack.md` sudah menjanjikan "Claude Code headless (CLI) + hooks".

## Keputusan
Runner `spawn("claude")` sendiri lewat `runner/src/claude-cli.ts`, memakai
`--input-format stream-json --output-format stream-json`, dan **`--setting-sources
user,project,local`** agar run berjalan dengan konfigurasi yang sama dengan sesi harian.
Dependency `@anthropic-ai/claude-agent-sdk` dicabut dari `server` dan `cli`.

Guardrail `canUseTool` adalah callback JavaScript dan tidak bisa menyeberang batas proses.
Penggantinya **PreToolUse hook** yang didaftarkan lewat `--settings` inline dan memanggil
`hanoman hook pretooluse` — menumpang pola `hook stop` yang sudah ada, tanpa MCP server.
Hooks dari `--settings` **merge** dengan milik user, bukan menggantikannya.
`--disallowed-tools` tetap dipasang sebagai lapis kedua (globnya lebih kasar daripada regex
`deniesDangerous`).

Run dipanggil dengan **`--dangerously-skip-permissions`**, bukan `--permission-mode
acceptEdits`. Itu terjemahan setia dari `canUseTool` lama, yang semantiknya "izinkan semua
kecuali `deniesDangerous`": run tak berpenunggu, tak ada yang bisa menjawab prompt izin, dan
`acceptEdits` hanya melonggarkan tool edit sehingga tool lain bisa menggantung. Konsekuensinya
**PreToolUse hook menjadi satu-satunya gerbang yang tersisa**.

Terverifikasi langsung terhadap binary, bukan disimpulkan dari dokumen: di bawah
`--dangerously-skip-permissions`, `claude` tetap mencoba `Bash(rm -rf …)` (satu `tool_use`),
hook mengembalikan `permissionDecision: "deny"`, dan file umpan selamat. Hook tetap hidup;
yang dilewati adalah prompt izin, bukan sistem hook — jadi Stop hook Source of Truth juga
tidak terbypass (lihat CLAUDE.md).

`--effort` menerima kosakata yang sama dengan `steps[*].effort`, jadi map `THINK` dan
`RunDeps.effortToThinking` — yang terduplikasi di `server` dan `cli` — dihapus.

## Konsekuensi
- (+) Kontrol penuh atas argv/env per run; nol dependency SDK.
- (+) Run memuat CLAUDE.md, hook, plugin, dan skill user — "as is" seperti kerja harian.
- (+) Satu `queryFn` dipakai bersama; duplikasi `queryFn` + `THINK` di dua paket hilang.
- (−) Run **tidak lagi hermetik**: perubahan di `~/.claude` mengubah perilaku run, dan hook
  `SessionStart` global menambah token tiap fase. Ini diterima sadar, itu memang tujuannya.
- (−) `--dangerously-skip-permissions` memindahkan seluruh beban keamanan ke satu PreToolUse
  hook yang matcher-nya `Bash`. Tool non-Bash tidak tersaring. Setiap penambahan pola berbahaya
  harus masuk `deniesDangerous` dan diuji terhadap binary asli, bukan hanya unit test.
- (−) Kontrak stdin/stdout `stream-json` tidak didokumentasikan resmi oleh Anthropic;
  kami memverifikasinya langsung terhadap binary dan mengunci perilakunya lewat
  `runner/test/claude-cli.test.ts`. Upgrade `claude` bisa menggesernya.
- (−) `claude` harus ada di `PATH` worker (override lewat `HANOMAN_CLAUDE_BIN`).

## Catatan
Porting ini membongkar bug lama di penghitungan token: `usage.*_tokens` bersifat per-giliran
sementara `total_cost_usd` kumulatif per sesi, jadi fase `Execute` yang di-steer dulu hanya
melaporkan token giliran terakhir. Sekarang token diakumulasi (`+=`), cost tetap assign.
