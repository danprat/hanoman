// Each entry is a package dir so vitest can apply its own environment
// (server: node + sequential DB; src: jsdom).
//
// `runner` dan `cli` dulu absen di sini, jadi `pnpm test` di root melewatkan justru
// paket yang memuat logika orkestrasi — test runner hijau hanya kalau seseorang ingat
// menjalankannya per-paket. live-smoke.test.ts aman ikut: `describe.runIf(HANOMAN_LIVE)`.
export default ["shared", "server", "src", "runner", "cli"];
