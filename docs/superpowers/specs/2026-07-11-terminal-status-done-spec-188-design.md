# SPEC-188 — Terminal Status Done

## Objective
Tambahkan pembeda **kontras** pada sesi terminal yang sudah selesai. Kasus nyata dari
brief: di grid Terminal tak ada pembeda yang jelas antara sesi yang masih hidup dan yang
sudah berakhir — yang ada terlalu samar. Yang diharapkan: begitu sesi berakhir, cell-nya
menunjukkan status "selesai" yang langsung terbaca.

Prioritas: tinggi. Sumber: brief.

## Konteks
Sesi terminal dirender per-cell oleh `Cell` di `src/src/screens/TerminalScreen.tsx`. Tiap
sesi punya flag `exited: boolean` (`api/client.ts:6`) yang di-set `true` oleh `markExited`
saat `TerminalPane` melaporkan proses berakhir (`onExit`). Sesi yang exited **tetap** di
grid sampai pengguna menutupnya (`close` → `DELETE`), jadi cell-nya masih terlihat.

Pembeda yang ada hari ini, keduanya samar (`TerminalScreen.tsx:404,407`):
- Warna teks header diredupkan: `session.exited ? "var(--text-muted)" : "var(--text-body)"`.
- Suffix teks kecil `{session.exited && " · berakhir"}` di ujung label.

**Akar masalah:** keduanya perubahan halus pada teks monospace 11px — tak ada elemen
berwarna/berbentuk yang menandai "selesai". Persis keluhan brief: "tidak ada pembeda yang
kontras."

Design system sudah punya vocab status yang tepat: `StatusPill`
(`src/src/ds/components/feedback.tsx:82-113`) dengan `status="done"` merender pill hijau —
titik `--leaf-600` + latar `--status-ok-tint` + label "Done". Inilah penanda kontras yang
sudah dipakai di seluruh app untuk keadaan selesai; tak perlu bikin baru.

## Keputusan
Dua sentuhan kecil di `Cell`, tanpa server/skema/tipe berubah:

1. **Badge status.** Ganti suffix `" · berakhir"` dengan `StatusPill status="done"` berlabel
   **"Selesai"** (override label Inggris default "Done" agar sejalan dengan UI berbahasa
   Indonesia), ukuran `sm`, ditaruh di header di antara label dan ikon-ikon aksi. Muncul
   hanya bila `session.exited`.

2. **Redupkan badan terminal.** Saat `session.exited`, badan cell di bawah header
   (`PhaseStrip` + kontainer `TerminalPane`) diberi `opacity: 0.6` — menandakan terminalnya
   beku/tak lagi hidup. **Header dan badge tetap opacity penuh** supaya statusnya justru
   paling kontras, tidak ikut pudar. Warna teks header tetap muted seperti sekarang.

### Detail
- Import `StatusPill` dari `../ds` (barrel sudah mengekspornya).
- Header: `{session.exited && <StatusPill status="done" size="sm">Selesai</StatusPill>}`
  disisipkan setelah `<span>` label (`flex: 1`) dan sebelum ikon dokumen/review/integrate.
- Label header dibersihkan: `{label} · {session.id.slice(0, 6)}` — tanpa `" · berakhir"`
  (badge sudah menyampaikannya, dan menyisakan dua penanda "selesai" itu redundan).
- Badan redup: bungkus `PhaseStrip` + div `TerminalPane` dengan `opacity` bersyarat, atau
  set `opacity` pada tiap-tiap, mana yang paling kecil diff-nya. Nilai `0.6`.

## Yang TIDAK berubah
- Server, route, `pty.ts`, skema Prisma, tipe `TerminalSession` — nol perubahan.
- Perilaku `exited` (kapan di-set, `close`, rekonsiliasi tray) tetap sama.
- `markExited` tetap membuang exit-code; tidak ada pembedaan sukses/gagal (itu fitur lain,
  di luar scope — brief hanya minta pembeda "selesai vs belum").

## Di luar scope (YAGNI)
- **Tray & picker sel kosong.** Chip di tray (`TerminalScreen.tsx:143-156`) dan opsi picker
  tak diberi penanda selesai — sesi yang exited normalnya duduk di cell-nya sendiri; tray
  cuma tempat singgah sementara. Bisa ditambah nanti bila terbukti perlu.
- **Exit-code sukses vs gagal.** Butuh menyimpan code di state sesi dan varian pill
  `failed`; fitur terpisah.

## Konsekuensi
- Sesi selesai kini punya penanda hijau "Selesai" yang kontras + badan terminal yang meredup
  — pembeda visual yang diminta brief, memakai komponen DS yang sudah ada (nol dependensi,
  nol kode DS baru).
- Suffix `" · berakhir"` hilang; satu-satunya pembeda selesai kini badge + redup.
- Tak ada ADR: bukan perubahan skema maupun konvensi (guardrail SoT sudah dicabut, SPEC-160).
