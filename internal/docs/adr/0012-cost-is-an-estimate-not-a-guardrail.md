# ADR 0012 — Biaya adalah estimasi, bukan guardrail

**Status:** superseded oleh [ADR-0024](0024-sesi-interaktif-menggantikan-run.md) (SPEC-162) — sesi interaktif tak melacak biaya
**Menggantikan sebagian:** rem anggaran yang diperkenalkan bersama `dailyBudget`.

## Konteks
Run mengautentikasi dengan OAuth subscription (`CLAUDE_CODE_OAUTH_TOKEN`), bukan API key.
`total_cost_usd` yang dilaporkan `claude` adalah jumlah yang **akan** dibayar pengguna API key —
bukan tagihan. Menegakkan "anggaran harian $50" atas angka nosional itu memberi rasa aman palsu:
plafon sesungguhnya pada subscription adalah rate limit, dan itu muncul sebagai `rate_limit_event`,
bukan sebagai biaya.

Pemeriksaan kode juga menemukan rem per-run tidak pernah aktif: `RunInput.maxBudgetUsd` dideklarasikan
dan diteruskan sampai `buildArgs`, tapi **tidak ada satu pun kode yang mengisinya**, jadi
`--max-budget-usd` tak pernah dikirim. Satu-satunya rem yang benar-benar hidup adalah gate
`dailyBudget` di `enqueueRun`.

## Keputusan
Biaya tetap dihitung dan **ditampilkan sebagai estimasi** (`~$0.03`), tapi tidak menggerakkan apa pun.

Dihapus: `dailyBudget` (setting, akses, dan gate di `enqueueRun`), `todaySpendUsd`, field Settings
di UI, serta plumbing mati `maxBudgetUsd` (`RunInput` → `RunPhaseArgs` → `CliOptions` → `buildArgs`).

Format dan parse estimasi dipusatkan di `fmtEstCost`/`parseEstCost` (`@hanoman/shared`) supaya
penulis di server, reducer SSE, dan baris seed tidak melenceng.

`Setting.data` adalah kolom Prisma `Json` dan `zSetting` bersifat non-strict, jadi **tidak perlu
migration**: baris lama yang masih menyimpan `dailyBudget` tetap terbaca, dan klien lama yang masih
mengirimnya tetap lolos validasi (key-nya di-strip saat tulis berikutnya). Baris `cost` lama
berformat `$n` tetap ter-parse karena `parseEstCost` membuang semua selain digit dan titik.

## Konsekuensi
- (+) Tak ada lagi angka dolar yang berpura-pura jadi tagihan, dan tak ada gate yang menolak run
  berdasarkan angka nosional itu.
- (+) Plumbing mati `maxBudgetUsd` hilang; satu setting dan satu field UI hilang.
- (−) **Tidak ada lagi rem otomatis** pada agen tak berpenunggu yang berjalan dengan
  `--dangerously-skip-permissions` (ADR-0010). Loop yang kabur akan berhenti hanya saat menabrak
  rate limit — dan itu menggantung, bukan gagal secara legible. Kendali yang tersisa: `maxConcurrent`,
  pause/stop dari UI, dan `--disallowed-tools` + PreToolUse hook.

## Catatan
Penghapusan gate ini membongkar bug laten di `runOne`: `subtype` hanya diperiksa untuk
`error_max_budget*`, sehingga setiap subtype error lain (`error_during_execution`, `error_max_turns`)
diperlakukan sebagai fase `done` dan run tetap commit + push. Sekarang **semua** `error_*` menggagalkan
run, diuji lewat `it.each` di `runner/test/run.test.ts`.

Perbaikan itu ternyata belum menutup lubangnya. RUN-8804 (502) dan RUN-8805 (401) memperlihatkan
bahwa kegagalan API di tengah giliran **tidak memakai subtype `error_*` sama sekali**: claude
v2.1.205 memancarkan `subtype: "success"` dengan `is_error: true` dan `api_error_status` berisi kode
HTTP-nya. `subtype` karena itu bukan "satu-satunya sinyal gagal yang tersisa" seperti ditulis
ADR-0015 — ia hanya separuhnya. Fase yang tak pernah jalan ditandai `done`, `progress` mencapai 100,
dan karena `donePhases` dibaca dari fase `done`, sebuah retry akan **melewati seluruh pipeline**.
`runOne` sekarang menggagalkan fase saat `subtype` berawalan `error` **atau** `is_error` bernilai
true. Sebab kematian aslinya dulu tertutup lagi oleh `commitAndPush`, yang melempar
"nothing to commit" di atas pohon yang sudah bersih di-commit agen; ia kini melewati commit kosong.
