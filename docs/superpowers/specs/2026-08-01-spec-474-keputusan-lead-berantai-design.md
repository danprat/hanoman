# SPEC-474 — Keputusan lead berantai sampai submit

Tanggal: 2026-08-01 · Sumber: brief · Prioritas: tinggi · Branch: `hanoman/spec-474`
Menegakkan [ADR-0091](../../../internal/docs/adr/0091-hanoman-lead-agen-pemimpin.md); melanjutkan
mekanisme SPEC-452 (`services/tui-dialog.ts`). Tanpa ADR baru, tanpa skema, tanpa endpoint, tanpa knob.

## Objective

hanoman-lead menjawab dialog `AskUserQuestion` yang **berantai** — satu tool call, beberapa
pertanyaan berturut-turut — **sampai dialognya benar-benar ter-submit**, dalam satu putaran deteksi,
tanpa pernah meninggalkan sesi menggantung di tengah rantai.

Tiga hal yang harus benar sekaligus:

1. **Setiap mata rantai dijawab** dengan keputusan lead-nya sendiri (bukan satu jawaban dipakai ulang,
   bukan opsi pertama).
2. **Rantai ditutup dengan submit** — layar review ditekan `Submit answers`, bukan ditinggalkan.
3. **Kegagalan di tengah tak menyamar jadi keberhasilan** — sesi yang belum tuntas tetap terlihat
   menunggu oleh operator.

## Yang sudah terukur (bukan asumsi)

Diukur in-vivo pada **claude 2.1.220** di mesin ini, 2026-08-01, lewat pane tmux nyata
(`capture-pane -p -J`) — metode yang sama dengan audit SPEC-452. Hook marker meniru
`guardSettings()` apa adanya (`runner/src/settings.ts`).

| # | Probe | Hasil |
|---|---|---|
| M1 | `AskUserQuestion` dengan **2 pertanyaan** dalam satu tool call | Layar memuat **tab strip** `←  ☐ Warna  ☐ Ukuran  ✔ Submit  →` di atas pertanyaan; footer `Enter to select · **Tab/Arrow keys to navigate** · Esc to cancel` (satu pertanyaan: `↑/↓ to navigate`). |
| M2 | Jawab pertanyaan pertama lewat kolom bebas (jalur SPEC-452) | Dialog **maju ke pertanyaan berikutnya** (`←  ☒ Warna  ☐ Ukuran  ✔ Submit  →`). **Tak ada yang ter-submit.** |
| M3 | Jawab pertanyaan terakhir | Muncul **layar review**: `Review your answers`, rekap tiap pertanyaan, `Ready to submit your answers?`, lalu `❯ 1. Submit answers` / `  2. Cancel`. **Tak ada baris footer chord sama sekali** (40 baris pane, 8 baris terakhir kosong). |
| M4 | Ketik prosa 38 karakter di layar review | Layar **byte-identik** (prosa ditelan). Keystroke **`1` telanjang** (tanpa Enter) → **submit seketika**; `Enter` juga submit karena baris 1 yang tersorot. |
| M5 | Marker keputusan (SPEC-184) sepanjang rantai | Terisi **satu kali** (8 B, ±15 dtk sesudah dialog tampil) lalu **tak pernah bertambah**: 8 B saat Q2 tampil, 8 B saat review tampil. |
| M6 | Marker dikosongkan di tengah rantai (meniru `detect.ts`) lalu ditunggu | **0 B selama 120 detik** dengan dialog masih terbuka. Hook `Notification` **tidak pernah menembak lagi**. |
| M7 | `AskUserQuestion` yang opsinya ber-`preview` | Tata letak **berbeda**: hanya opsi yang bernomor, **tak ada baris `Type something.`**, `Chat about this` **tanpa nomor**, catatan lewat tombol `n` — footer `Enter to select · ↑/↓ to navigate · **n to add notes** · Tab to switch questions · Esc to cancel`. |
| M8 | Varian preview dijawab `n` → prosa → `Enter` | Maju ke pertanyaan berikutnya; review menampilkan `→ (notes only)`, **tapi prosa utuh sampai ke model** — ringkasan claude sesudah submit: “Loop: map — ekspresif dan tanpa efek samping”, “Nama: exec — konsisten dengan modul lain”. |
| M9 | Biner claude 2.1.220 (`strings`) | `hideSubmitTab = questions.length === 1 && !questions[0].multiSelect`; `onAnswer` ber-`shouldAdvance` menaikkan `currentQuestionIndex`; `currentQuestionIndex === questions.length` → layar review; submit = `onFinalResponse("submit")`. Kontrak tool: **1–4 pertanyaan**. |

### Konsekuensi langsung

- **M2+M5+M6 ⇒ hari ini rantai berakhir sebagai HANG SENYAP.** `detect.ts` menjawab pertanyaan
  pertama, `clearMarker()` mengosongkan markernya (SPEC-452, benar untuk dialog satu pertanyaan),
  menaikkan penghitung `answers`, dan melaporkan `answered`. Dialog masih terbuka di pertanyaan
  kedua — tapi marker kosong dan **tak akan pernah terisi lagi**, jadi putaran berikutnya
  melewati sesi itu lewat `if (!deps.filled(...)) continue;` **tanpa satu baris skip pun**. Sesi
  tak “menunggu”, tak berjalan, dan pane-nya tetap hidup: satu slot governor terkunci selamanya
  (kelas SPEC-451).
- **M9 ⇒ satu-satunya kasus yang hari ini benar adalah dialog SATU pertanyaan non-multiSelect** —
  di sana `hideSubmitTab` menyala dan menjawabnya langsung men-submit. Setiap dialog lain
  (≥ 2 pertanyaan, atau satu pertanyaan `multiSelect`) berakhir menggantung.
- **M3 ⇒ layar review tak terbaca `readChoiceDialog`.** Parser SPEC-452 mensyaratkan footer
  `enter to (select|confirm)`; layar review tak punya footer. Ia karena itu jatuh ke jalur “kolom
  chat biasa”. Kebetulan hasil akhirnya benar (prosa ditelan, `Enter` memilih baris 1 = Submit,
  M4) — **tapi kebenaran karena kebetulan bukan kontrak**, dan harganya satu panggilan agen lead
  penuh untuk menekan satu tombol yang tak butuh pertimbangan apa pun.
- **M4 ⇒ submit tak perlu keputusan.** Menekan `Submit answers` adalah langkah mekanis; memanggil
  agen untuk itu membakar giliran dan satu jatah `maxAutoAnswers`.
- **M7 ⇒ varian preview hari ini dijawab SALAH secara senyap.** Layarnya lolos sebagai dialog
  (baris bernomor + footer `Enter to select`) tetapi `freeIndex` = `null`, jadi `sendToPane`
  jatuh ke jalur lama: prosa ditelan, `Enter` memilih **baris 1** — persis bug SPEC-452, hanya di
  bentuk dialog yang belum pernah diukur. Di dalam rantai ia lebih buruk lagi: rantai tetap maju,
  jadi jawabannya salah **dan** tak ada gejala.
- **M8 ⇒ jalan keluarnya sudah disediakan claude sendiri.** Kolom catatan (`n`) adalah kolom teks
  biasa; prosanya sampai ke model verbatim meski nilai yang tampil di review `(notes only)`.
- **M5 ⇒ jangan pernah menunggu marker terisi ulang di tengah rantai.** Rantai harus dituntaskan
  **dalam satu putaran deteksi**, bukan satu mata rantai per denyut.

## Pilihan yang dipertimbangkan

**A. Rantai digerakkan `detect.ts`, satu mata rantai satu keputusan lead. (dipilih)**
Pintu deteksi sudah memegang semua yang dibutuhkan: konfigurasi, gerbang opt-in/pause, `decide()`,
jejak, notifikasi, dan penghitung pagar. Ia menjawab, membaca ulang layar, dan mengulang sampai
layar bukan dialog lagi; layar review ditekan mekanis. `tui-dialog.ts` tetap murni untuk pembacaan
dan menerima primitif tulis lewat `PaneIO` (pola SPEC-452).
*Harga:* satu panggilan agen per pertanyaan (2–4 per dialog). Itu memang harga sebenarnya — tiap
pertanyaan adalah keputusan yang berbeda, dan pertanyaan ke-2 **tak bisa dibaca** sebelum yang
pertama dijawab (M2), jadi “satu panggilan untuk semua” bukan pilihan yang tersedia.

**B. `pty.sendToPane` menuntaskan rantainya sendiri.** Ditolak: jawaban mata rantai berikutnya harus
datang dari lead, sementara `pty.ts` **nol dependensi DB** dan tak boleh memanggil `decide()`.
Satu-satunya cara memenuhinya adalah menyuntikkan callback keputusan ke pty — membalik arah
dependensi demi menghemat satu lapisan.

**C. Tolak dialog berantai, serahkan ke operator.** Ditolak sebagai tujuan, **dipakai sebagai
perilaku gagal**: begitu satu mata rantai tak bisa dijawab, sisanya memang harus jatuh ke operator —
dengan marker **tetap terisi** supaya sesinya terlihat menunggu, bukan dikosongkan seperti hari ini.

## Arsitektur

```
detect.ts · scanAndAnswer()                       tui-dialog.ts (murni + PaneIO)
  ├─ marker terisi & pane hidup
  ├─ readPaneQuestion(pane)  ──────────────────►  readChoiceDialog()      (SPEC-452, tak berubah)
  │
  └─ RANTAI (maks MAX_CHAIN_STEPS = 6)
      langkah k:
        ├─ readDialogScreen(pane) ─────────────►  { kind: "question" | "review" } | null
        │     ├─ "review"  → submitReview(io) ─►  ketik "<n>" satu karakter, verifikasi layar pergi
        │     │                                    (TANPA memanggil agen lead)
        │     ├─ null      → rantai selesai (layar bukan dialog lagi)
        │     └─ "question"
        ├─ decide({ gate:"detected", kind:"answer", question, options, notes })   ← 1 agen / pertanyaan
        ├─ send(reply)  ───────────────────────►  answerChoiceDialog()  (kolom bebas)   ← M2
        │                                     ►  answerNotesDialog()   (varian preview) ← M7/M8
        └─ layar tak berubah? → berhenti (anti-loop)                                    ← AC-9
      selesai:
        ├─ submit/keluar dialog → clearMarker() + answers += 1  (SATU rantai = SATU jawaban)
        └─ gagal di tengah      → marker DIBIARKAN + failures += 1
```

### Berkas yang tersentuh

| Berkas | Perubahan |
|---|---|
| `server/src/services/tui-dialog.ts` | `readDialogScreen()` (union `question`\|`review`), parser tab strip, parser layar review, `answerNotesDialog()`, `submitReview()` |
| `server/src/services/pty.ts` | `sendToPane` mengenali varian preview & layar review; ekspor `paneDialogState()` + `submitPaneDialog()` |
| `server/src/services/lead/detect.ts` | putaran rantai, `MAX_CHAIN_STEPS`, marker dikosongkan di ujung rantai, penghitung per-rantai |
| `server/src/services/lead/pane.ts` | `readPaneQuestion` menyodorkan opsi juga untuk varian preview |
| `internal/skills/hanoman/SKILL.md` | butir permanen (gotcha rantai, review tanpa footer, marker sekali isi, varian preview) |

### Bentuk data (murni, tanpa DB)

```ts
export type DialogScreen =
  | { kind: "question"; rows: ChoiceRow[]; freeIndex: number | null;
      notesIndex: boolean; options: string[]; tabs: DialogTab[] }
  | { kind: "review"; submitRow: number };

export type DialogTab = { header: string; answered: boolean };   // "☐ Warna" / "☒ Warna"
```

`tabs` kosong berarti “bukan `AskUserQuestion`” (dialog trust/izin) — pembeda yang memisahkan
“boleh dijawab bebas” dari “Enter = baris 1 = ya”.

## Keputusan desain yang mengikat

1. **Satu rantai = satu jawaban otomatis.** Pagar `maxAutoAnswers` (default **3**) mengukur *berapa
   kali lead ikut campur pada satu sesi*, bukan berapa keystroke yang dikirim. Menghitung per
   pertanyaan membuat dialog 4 pertanyaan — bentuk maksimum yang diizinkan kontrak tool (M9) —
   **mustahil selesai** pada setelan default: pagarnya menutup di tengah rantai dan meninggalkan
   dialog setengah terjawab, tepat keadaan yang spec ini hapus.
2. **Batas rantai adalah KONSTANTA, bukan knob.** `MAX_CHAIN_STEPS = 6` (cermin `LEAD_ACTIONS`
   ADR-0091 yang sengaja konstanta modul). Kontrak tool memberi maksimum 4 pertanyaan; 6 memberi
   kelonggaran dua langkah (layar review + satu layar tak terduga) tanpa pernah tak berbatas.
3. **Submit tak pernah memanggil agen.** Ia mekanis dan hasilnya tunggal.
4. **Marker dikosongkan hanya di ujung rantai.** Kalau rantai putus, sesi harus tetap terbaca
   “menunggu”. Ini kebalikan dari hari ini dan justru pengaman utamanya.
5. **Fail-closed diwarisi utuh dari SPEC-452.** Ragu → jalur lama. `Enter` hanya sesudah teks
   terbukti mendarat. Dialog tanpa tab strip (trust, prompt izin) tak disentuh sama sekali.
6. **Anti-loop lewat perubahan layar, bukan lewat hitungan saja.** Kalau sesudah dijawab pertanyaan
   di layar tetap sama, rantai berhenti — pane yang tak menerima apa pun tak boleh membuat lead
   mengetik berulang-ulang.
7. **Varian preview dijawab lewat kolom catatan**, bukan ditolak dan bukan ditekan `Enter`-nya.
   Ia bagian dari “sampai submit”: satu pertanyaan ber-preview di tengah rantai yang tak bisa
   dijawab akan menghentikan seluruh rantai.

## Acceptance criteria (EARS)

- **AC-1** WHEN layar sesi adalah `AskUserQuestion` dengan lebih dari satu pertanyaan, THE SYSTEM
  SHALL menjawab tiap pertanyaan berurutan, satu keputusan lead per pertanyaan, dalam satu putaran
  deteksi.
- **AC-2** WHEN layar review (`Ready to submit your answers?`) muncul, THE SYSTEM SHALL menekan
  baris `Submit answers` sebagai keystroke **satu karakter** dan SHALL NOT memanggil agen lead.
- **AC-3** WHERE jawaban dimasukkan ke kolom bebas, THE SYSTEM SHALL menekan `Enter` **hanya**
  sesudah teksnya terbukti mendarat (SPEC-452 dipertahankan utuh).
- **AC-4** THE SYSTEM SHALL mengosongkan marker keputusan **hanya** sesudah layar bukan dialog lagi
  (ter-submit atau ditutup).
- **AC-5** IF satu mata rantai gagal (keputusan tak berlaku, ketikan tak mendarat, layar tak
  berubah), THEN THE SYSTEM SHALL menghentikan rantai, membiarkan marker terisi, dan menaikkan
  penghitung kegagalan sesi itu.
- **AC-6** THE SYSTEM SHALL membatasi satu rantai pada `MAX_CHAIN_STEPS` langkah; saat batas
  tercapai rantai berhenti dan sesi diserahkan ke operator.
- **AC-7** THE SYSTEM SHALL menghitung satu rantai — berapa pun pertanyaannya — sebagai **satu**
  jawaban otomatis terhadap `maxAutoAnswers`.
- **AC-8** WHERE pertanyaan tak punya baris `Type something.` tetapi punya tab strip (varian
  preview), THE SYSTEM SHALL menjawab lewat kolom catatan (`n` → prosa → `Enter`) dan SHALL NOT
  menekan `Enter` selagi fokus masih di daftar opsi.
- **AC-9** IF pertanyaan di layar tak berubah sesudah dijawab, THEN THE SYSTEM SHALL menghentikan
  rantai (anti-loop).
- **AC-10** THE SYSTEM SHALL tidak mengubah perilaku untuk dialog tanpa tab strip (trust, prompt
  izin) maupun untuk kolom chat biasa.
- **AC-11** WHEN dialog hanya punya satu pertanyaan non-`multiSelect`, THE SYSTEM SHALL berperilaku
  persis seperti sebelum spec ini (satu jawaban, langsung selesai).

## Rencana verifikasi

- **Unit `tui-dialog`** atas fixture tangkapan NYATA M1/M2/M3/M7 (bukan karangan): tab strip
  terbaca berikut status `☐`/`☒`; layar review dikenali **tanpa** footer; kolom chat & dialog trust
  tetap `null`/tanpa perubahan.
- **Unit `answerNotesDialog` / `submitReview`** dengan TUI palsu yang meniru semantik terukur
  (burst > 1 karakter ditelan di daftar; `n` membuka kolom catatan; satu digit memilih seketika).
- **Unit `detect` rantai** dengan pane bertahap (Q1 → Q2 → review → selesai): tiga `decide()`?
  **Tidak** — dua `decide()` untuk dua pertanyaan, submit tanpa agen; marker kosong sekali di ujung;
  `answers` naik **1**.
- **Unit `detect` rantai putus**: keputusan kedua gagal → marker **tetap terisi**, `failures` naik,
  `answers` tak naik.
- Regresi: seluruh test SPEC-452 lama tetap hijau tanpa diubah maknanya.

## Yang sengaja TIDAK dikerjakan

- **Menekan `Cancel`/`Esc`** pada dialog mana pun. Membatalkan membuang jawaban yang sudah masuk dan
  mengembalikan penolakan tool ke agen; lead tak pernah punya alasan untuk itu.
- **Tab/panah untuk pindah pertanyaan.** Dialog maju sendiri sesudah dijawab (M2); menavigasi manual
  hanya menambah keadaan yang bisa salah.
- **Knob baru.** Batas rantai konstanta, pagar sesi memakai `maxAutoAnswers` yang sudah ada.
- **Sisi codex.** Codex tak punya widget `AskUserQuestion`; `readPaneQuestion` untuk codex tak
  disentuh.
