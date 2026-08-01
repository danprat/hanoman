import { goalChunks } from "@hanoman/runner";

// SPEC-452 · dialog pilihan di layar agen. Pembacaannya murni (masuk teks pane, keluar bentuk
// dialognya); penulisannya lewat primitif yang DISUNTIKKAN (`PaneIO`), supaya seluruh perilakunya
// bisa dikunci test tanpa tmux (pola `lead/pane.ts` & `runner/src/agent-cli.ts`).
//
// Alasan modul ini ada: `sendToPane` selama ini mengasumsikan pane SELALU berupa kolom teks. Untuk
// `AskUserQuestion` asumsi itu salah — layarnya widget daftar milik Ink, dan handler-nya
// membandingkan `input` UTUH dengan nomor baris. Terukur pada claude 2.1.220: burst apa pun yang
// lebih dari SATU karakter ditelan tanpa jejak, lalu `Enter` memilih baris yang sedang disorot
// (baris 1). Jadi seluruh isi keputusan lead hilang dan yang terpilih selalu opsi pertama.
//
// Jalan keluarnya disediakan claude sendiri: setiap `AskUserQuestion` punya baris kolom-bebas
// ("Type something.") di nomor `jumlah_opsi + 1`, dan mengetiknya menerima prosa apa adanya —
// persis cara manusia menjawab dengan kalimat sendiri. Modul ini yang menemukan nomor itu.

/** Satu baris bernomor di layar dialog. */
export type ChoiceRow = {
  n: number;
  label: string;
  /** Baris kolom jawaban bebas (`{type:"input", value:"__other__"}` di claude). */
  free: boolean;
  /** Baris "Chat about this" — menekan nomornya melempar sesi kembali ke percakapan biasa. */
  chat: boolean;
  /**
   * SPEC-485 · keadaan kotak centang: `true`/`false` untuk dialog `multiSelect`, `null` untuk
   * dialog biasa yang memang tak punya kotak. `null` BUKAN "belum tercentang" — membedakan
   * keduanya adalah cara modul ini tahu ia sedang melihat widget yang mana.
   */
  checked: boolean | null;
};

export type ChoiceDialog = {
  rows: ChoiceRow[];
  /** Nomor baris kolom jawaban bebas, atau `null` bila dialog ini tak punya (trust, prompt izin). */
  freeIndex: number | null;
  /** Label opsi sebenarnya — tanpa baris bebas & tanpa "Chat about this". */
  options: string[];
  /** SPEC-485 · dialog `multiSelect`: opsinya berkotak dan digit MEN-TOGGLE, bukan memilih. */
  multi: boolean;
  /**
   * SPEC-485 · tombol kirim `Submit`/`Next` — TANPA nomor, jadi ia hanya bisa ditekan dengan
   * memindahkan fokus ke sana lalu `Enter`. Keberadaannya sekaligus alasan `Enter` di baris opsi
   * TIDAK mengirim apa pun (ia men-toggle baris tersorot).
   */
  submit: { present: boolean; focused: boolean };
};

// Footer chord dialog. Ini pembeda paling murah antara layar dialog dan kolom chat biasa (yang
// footer-nya berbunyi "bypass permissions on … · ← for agents"). `select` dipakai AskUserQuestion,
// `confirm` dipakai dialog trust.
const FOOTER = /enter to (?:select|confirm)\b/i;

// `❯` menandai baris tersorot; `-J` pada capture-pane sudah menyambung baris yang terlipat.
const ROW = /^\s*[❯>›]?\s*(\d{1,2})\.\s+(\S.*)$/;

// Label baris kolom-bebas saat masih kosong = placeholder-nya. `Type something.` (single-select)
// vs `Type something` (multiSelect) — keduanya dari biner claude; `Other` adalah label internalnya.
const PLACEHOLDER = /^(?:type something\.?|other)$/i;
const CHAT_ROW = /^chat about this$/i;

// SPEC-474 · varian ber-`preview` menaruh panel pratinjau di KOLOM YANG SAMA dengan baris opsi
// (`  2. map                        │ xs.map(f) │`), jadi label mentahnya ikut menyeret ornamen
// kotak. Potong di batas kolomnya — tanpa ini opsi yang disodorkan ke lead penuh garis kotak.
const SIDE_PANEL = /\s{2,}[│┃┌┐└┘├┤╭╮╰╯─━].*$/;
const cleanLabel = (s: string): string => s.replace(SIDE_PANEL, "").trim();

// SPEC-485 · dialog `multiSelect` merender kotak centang DI DEPAN label: `1. [ ] alpha` /
// `2. [✔] beta`. Tanpa dikupas, label yang sampai ke lead penuh ornamen DAN `[ ] Type something`
// tak lagi cocok `PLACEHOLDER` — kolom bebasnya jadi tak terlihat, dan `sendToPane` jatuh ke jalur
// terakhir (prosa + `Enter`) yang di widget ini justru men-toggle opsi 1.
const CHECK = /^\[([ xX✔✓])\]\s*(.*)$/;

// Tombol kirim multiSelect: `     Submit` / `❯    Submit`, dan berbunyi `Next` bila pertanyaannya
// belum yang terakhir dalam rantai (`submitButtonText: last ? "Submit" : "Next"`). Pola ini sengaja
// menuntut baris TANPA nomor, supaya `N. Submit answers` milik layar rekap (SPEC-474) tak ikut
// tertangkap — dua tombol berbeda di dua layar berbeda.
const SUBMIT_BTN = /^\s*([❯>›])?\s{2,}(Submit|Next)\s*$/;

/**
 * Turunkan bentuk dialog dari layar pane. `null` = ini bukan layar dialog, dan pemanggil harus
 * berperilaku persis seperti sebelum SPEC-452 (prosa + Enter ke kolom chat).
 *
 * FAIL-CLOSED di setiap ragu: layar yang tak memenuhi ketiga syarat (footer chord, deret bernomor
 * berurutan mulai 1, minimal dua baris) dibaca sebagai BUKAN dialog. Salah arah di sini berarti
 * mengetik nomor ke kolom chat sesi yang sedang bekerja.
 */
export function readChoiceDialog(paneText: string): ChoiceDialog | null {
  const lines = paneText.split("\n").map((l) => l.trimEnd());
  // Footer TERAKHIR: scrollback memuat dialog-dialog lama, yang berlaku adalah yang paling bawah.
  let footer = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FOOTER.test(lines[i] ?? "")) { footer = i; break; }
  }
  if (footer < 0) return null;

  const found: { n: number; label: string }[] = [];
  for (const line of lines.slice(0, footer)) {
    const m = ROW.exec(line);
    if (m) found.push({ n: Number(m[1]), label: cleanLabel(m[2] ?? "") });
  }
  if (found.length < 2) return null;

  // Deret berurutan TERAKHIR: ditelusuri mundur dari baris bernomor paling bawah sampai nomor 1.
  const run: { n: number; label: string }[] = [];
  let expected = found[found.length - 1]!.n;
  for (let i = found.length - 1; i >= 0 && expected >= 1; i--) {
    const row = found[i]!;
    if (row.n !== expected) break;
    run.unshift(row);
    expected -= 1;
  }
  if (run.length < 2 || run[0]!.n !== 1) return null;

  // SPEC-485 · kotak centang dikupas SEBELUM baris dinilai: `free`/`chat`/`options` semuanya
  // bertanya pada LABEL, dan label yang masih menyeret `[ ] ` menjawab salah untuk ketiganya.
  const rows: ChoiceRow[] = run.map((r) => {
    const m = CHECK.exec(r.label);
    const label = m ? (m[2] ?? "").trim() : r.label;
    return {
      n: r.n, label,
      checked: m ? m[1] !== " " : null,
      free: PLACEHOLDER.test(label),
      chat: CHAT_ROW.test(label),
    };
  });
  let submit = { present: false, focused: false };
  for (const line of lines.slice(0, footer)) {
    const m = SUBMIT_BTN.exec(line);
    if (m) submit = { present: true, focused: !!m[1] };
  }
  return {
    rows,
    freeIndex: rows.find((r) => r.free)?.n ?? null,
    options: rows.filter((r) => !r.free && !r.chat).map((r) => r.label),
    multi: rows.some((r) => r.checked !== null),
    submit,
  };
}

/**
 * SPEC-485 · nomor baris yang sedang DISOROT (`❯`), atau `null` bila sorotannya bukan di baris
 * bernomor — yang di dialog multi berarti ia ada di tombol kirim.
 *
 * Dibutuhkan karena di widget `multiSelect` fokus TIDAK bisa dipindahkan dengan menekan nomor
 * (nomor men-toggle); satu-satunya jalan adalah panah, dan panah harus dibuktikan mendarat.
 */
export function focusedRow(paneText: string): number | null {
  const lines = paneText.split("\n").map((l) => l.trimEnd());
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*[❯>›]\s*(\d{1,2})\.\s+\S/.exec(lines[i] ?? "");
    if (m) return Number(m[1]);
  }
  return null;
}

/** Satu tab pertanyaan di strip atas dialog berantai: `☐ Warna` (belum) / `☒ Warna` (sudah). */
export type DialogTab = { header: string; answered: boolean };

/**
 * SPEC-474 · bentuk layar dialog yang sedang tampil.
 *
 * `question` = masih ada yang harus dijawab. `review` = seluruh pertanyaan sudah dijawab dan
 * dialognya tinggal ditutup — bentuk yang SELALU muncul untuk dialog berantai dan tak pernah
 * dikenali SPEC-452, sehingga rantai berhenti setengah jalan tanpa gejala.
 */
export type DialogScreen =
  | { kind: "question"; rows: ChoiceRow[]; freeIndex: number | null; notes: boolean;
      options: string[]; tabs: DialogTab[]; title: string;
      /** SPEC-485 · widget `multiSelect`: kotak centang + tombol kirim tanpa nomor. */
      multi: boolean; submit: { present: boolean; focused: boolean } }
  | { kind: "review"; submitRow: number };

// Layar review TIDAK punya footer chord (terukur: 40 baris pane, delapan baris terakhir kosong),
// jadi ia tak bisa dikenali lewat FOOTER seperti dialog lain. Dua penanda di bawah dipakai
// bersama-sama supaya kalimat yang kebetulan lewat di transkrip tak cukup untuk mengaku review.
const REVIEW_PROMPT = /^\s*ready to submit your answers\?\s*$/i;
const SUBMIT_ROW = /^\s*[❯>›]?\s*(\d{1,2})\.\s+submit answers\s*$/i;
// Varian ber-`preview` tak punya baris kolom-bebas; jalan masuk prosanya kolom catatan (tombol `n`).
const NOTES_FOOTER = /\bn to add notes\b/i;
const TAB_BOX = /^([☐☒])\s*(.+)$/;

const lastIndexOf = (lines: string[], re: RegExp): number => {
  for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i] ?? "")) return i;
  return -1;
};

/**
 * Tab strip dialog `AskUserQuestion`: `←  ☐ Warna  ☐ Ukuran  ✔ Submit  →`.
 *
 * Kosong berarti layar ini BUKAN `AskUserQuestion` — dialog trust & prompt izin tak punya strip.
 * Itu pembeda yang memisahkan "boleh dijawab bebas" dari "Enter = baris 1 = ya".
 */
function readTabs(lines: string[]): { tabs: DialogTab[]; at: number } {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (!/[☐☒]/.test(line)) continue;
    const tabs: DialogTab[] = [];
    for (const tok of line.split(/\s{2,}/)) {
      const m = TAB_BOX.exec(tok.trim());
      if (m) tabs.push({ header: (m[2] ?? "").trim(), answered: m[1] === "☒" });
    }
    if (tabs.length) return { tabs, at: i };
  }
  return { tabs: [], at: -1 };
}

// Garis pemisah TUI: baris yang isinya hanya ornamen kotak.
const RULE = /^[\s─━╌╍_=]*$/;

/**
 * Judul pertanyaan yang sedang tampil = baris berisi PERTAMA di bawah tab strip.
 *
 * Dipakai sebagai identitas layar (`dialogKey`), bukan sekadar hiasan: label baris kolom-bebas
 * berubah begitu prosa lead mendarat di sana, jadi identitas yang bersumber pada label baris akan
 * membaca layar yang MACET sebagai layar yang sudah maju. Judul tak tersentuh oleh pengetikan.
 */
function readTitle(lines: string[], stripAt: number, footer: number): string {
  if (stripAt < 0) return "";
  for (let i = stripAt + 1; i < footer; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line || RULE.test(line)) continue;
    return ROW.test(lines[i] ?? "") ? "" : line;   // langsung ketemu opsi = dialog tanpa judul
  }
  return "";
}

/** Layar rekap terakhir sebuah dialog berantai, atau `null` bila bukan layar itu. */
export function readReviewScreen(paneText: string): { submitRow: number } | null {
  const lines = paneText.split("\n").map((l) => l.trimEnd());
  const at = lastIndexOf(lines, REVIEW_PROMPT);
  if (at < 0) return null;
  for (const line of lines.slice(at)) {
    const m = SUBMIT_ROW.exec(line);
    if (m) return { submitRow: Number(m[1]) };
  }
  return null;
}

/**
 * Bentuk layar dialog yang sedang tampil. `null` = bukan layar dialog, dan pemanggil harus
 * berperilaku persis seperti sebelum SPEC-452 (prosa + Enter ke kolom chat).
 *
 * Urutannya mengikat: layar review dinilai lebih dulu, TAPI hanya bila ia berada di bawah footer
 * dialog terakhir. Scrollback memuat rekap-rekap lama, dan yang berlaku selalu yang paling bawah.
 */
export function readDialogScreen(paneText: string): DialogScreen | null {
  const lines = paneText.split("\n").map((l) => l.trimEnd());
  const footer = lastIndexOf(lines, FOOTER);
  if (lastIndexOf(lines, REVIEW_PROMPT) > footer) {
    const review = readReviewScreen(paneText);
    if (review) return { kind: "review", submitRow: review.submitRow };
  }
  const d = readChoiceDialog(paneText);
  if (!d) return null;
  const { tabs, at } = readTabs(lines.slice(0, footer));
  return {
    kind: "question", rows: d.rows, freeIndex: d.freeIndex, options: d.options,
    notes: d.freeIndex === null && NOTES_FOOTER.test(lines[footer] ?? ""),
    tabs, title: readTitle(lines, at, footer),
    multi: d.multi, submit: d.submit,
  };
}

/**
 * Kunci layar untuk gerbang anti-loop dan penanda "rantai sudah maju".
 *
 * Sengaja TIDAK memuat label baris kolom-bebas: begitu prosa lead mendarat di sana labelnya
 * berubah tanpa satu pun pertanyaan berpindah, dan kunci yang ikut berubah akan membaca layar
 * yang MACET sebagai layar yang maju.
 */
export function dialogKey(paneText: string): string {
  const s = readDialogScreen(paneText);
  if (!s) return "none";
  if (s.kind === "review") return "review";
  // GOTCHA ADR-0102 #1 · untuk layar MULTI penanda `☐/☒` tab strip WAJIB dibuang: mencentang satu
  // opsi sudah membalik tab yang sedang tampil jadi `☒` (terukur in-vivo) tanpa satu pun pertanyaan
  // berpindah. Kunci yang ikut berubah akan membaca layar yang MACET sebagai layar yang MAJU —
  // bentuk yang sama persis yang SPEC-474 tutup untuk label kolom bebas, lewat pintu baru.
  // Kemajuan layar multi terbaca dari JUDUL yang berganti, dari layar rekap, atau dari layar yang
  // berhenti jadi dialog; judul yang sama karena itu fail-closed ("belum maju").
  const tabs = s.multi
    ? s.tabs.map((t) => t.header).join(",")
    : s.tabs.map((t) => `${t.answered ? "x" : "o"}${t.header}`).join(",");
  // Judul dipakai bila ada; hanya dialog tanpa tab strip (trust, prompt izin) yang jatuh ke
  // label opsi — dan di sana rantai memang tak pernah berjalan.
  return `q|${s.multi ? "multi|" : ""}${tabs}|${s.title || s.options.join("|")}`;
}

/**
 * Apakah baris ber-nomor `n` sudah TERISI teks (bukan placeholder-nya lagi)?
 *
 * Gerbang wajib sebelum menekan `Enter`: kalau teks ternyata tak mendarat di kolom bebas, `Enter`
 * akan memilih baris yang sedang disorot — persis bug yang diperbaiki SPEC-452. Sengaja bertanya
 * lewat NOMOR baris, bukan lewat flag `free`: begitu terisi, labelnya jadi teks kita dan baris itu
 * tak lagi cocok dengan placeholder mana pun.
 */
export function freeTextFilled(paneText: string, n: number): boolean {
  const row = readChoiceDialog(paneText)?.rows.find((r) => r.n === n);
  if (!row) return false;
  return row.label.length > 0 && !PLACEHOLDER.test(row.label);
}

/** Primitif pane yang dibutuhkan untuk menjawab dialog — disuntikkan supaya bisa dites tanpa tmux. */
export type PaneIO = {
  capture: () => string;
  /** Kirim teks APA ADANYA (`send-keys -l`). */
  literal: (text: string) => void;
  enter: () => void;
  /**
   * SPEC-485 · geser fokus SATU baris ke bawah. Panggilan terpisah per langkah, bukan satu burst:
   * terukur, `send-keys Down Down Down Down` dalam satu pemanggilan memindahkan fokus SATU baris
   * saja — jebakan burst ADR-0085 ternyata tak berhenti di teks.
   */
  down: () => void;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Jeda supaya TUI sempat merender ulang sebelum keadaan berikutnya dibaca/diketik. Nilainya di
 * bawah waktu render terukur yang jauh lebih cepat dari ini; yang mahal bukan jedanya melainkan
 * salah membaca layar setengah jadi.
 */
export const DIALOG_SETTLE_MS = 250;

/**
 * SPEC-452 · jawab dialog pilihan lewat kolom jawaban bebasnya — cara manusia menjawab dengan
 * kalimatnya sendiri, bukan menekan opsi pertama.
 *
 * Urutannya MENGIKAT, ketiganya hasil pengukuran (lihat dokumen audit §3.3/§3.6):
 *
 * 1. Nomor barisnya dikirim sebagai `send-keys` TERSENDIRI berisi tepat SATU karakter. Ink
 *    menyerahkan satu burst PTY sebagai satu nilai `input`, dan handler dialog membandingkan
 *    nilai itu UTUH dengan nomor baris — nomor yang menempel pada teks lain tak pernah cocok.
 *    Karena itu memotong prosa (`goalChunks`) tak menolong sama sekali: potongan 500 karakter
 *    tetap bukan satu karakter.
 * 2. Prosanya baru dikirim SESUDAH kolom itu fokus. Sebelum fokus, burst apa pun ditelan tanpa
 *    jejak — layar tak berubah dan `send-keys` tetap sukses.
 * 3. `Enter` HANYA ditekan setelah teksnya terbukti mendarat. `Enter` pada daftar yang masih
 *    fokus memilih baris tersorot (baris 1) — itu bug SPEC-452 itu sendiri, dan menekannya
 *    "kalau-kalau berhasil" berarti mengulanginya lewat jalur baru. Gagal → `false`, sesi jatuh
 *    ke perilaku pra-ADR-0091: menunggu manusia.
 *
 * Prosa tetap dipotong `goalChunks`: kolom jawaban bebas adalah kolom teks, jadi jebakan
 * `[Pasted Content]` (ADR-0085) berlaku penuh di sana.
 */
export async function answerChoiceDialog(
  io: PaneIO, freeIndex: number, line: string, chunkMs: number,
): Promise<boolean> {
  io.literal(String(freeIndex));
  await io.sleep(DIALOG_SETTLE_MS);
  for (const chunk of goalChunks(line)) {
    io.literal(chunk);
    await io.sleep(chunkMs);
  }
  await io.sleep(DIALOG_SETTLE_MS);
  if (!freeTextFilled(io.capture(), freeIndex)) return false;
  io.enter();
  return true;
}

/** Berapa kali fokus digeser sebelum menyerah. Pane yang tak merespons harus punya ujung. */
const NAV_TRIES = 24;

/**
 * SPEC-485 · ADR-0102 · jawab dialog `multiSelect` dengan MENCENTANG.
 *
 * Urutannya MENGIKAT, semuanya hasil pengukuran in-vivo (claude 2.1.220):
 *
 * 1. **Digit MEN-TOGGLE**, bukan memilih-lalu-mengirim (`b = toggleValue` di widget). Jadi tiap
 *    opsi ditekan nomornya sebagai `send-keys` tersendiri berisi SATU karakter, lalu layarnya
 *    DIBACA ULANG untuk membuktikan kotaknya benar-benar berubah. Tanpa pembuktian itu, jawaban
 *    yang tak mendarat tetap berujung pada tombol kirim — bug SPEC-452 lewat pintu baru.
 * 2. **Kolom bebas hanya bisa dicapai lewat NAVIGASI.** Menekan nomornya justru men-toggle
 *    `__other__` dengan teks kosong (kebalikan penuh dari single-select, SPEC-452). Panah dikirim
 *    satu per pemanggilan dan posisinya dibuktikan lewat `❯`.
 * 3. **`Enter` hanya di tombol kirim.** Di baris opsi ia men-toggle, karena tombolnya ada.
 *
 * Fail-closed di tiap langkah: `false` berarti sesi jatuh ke perilaku pra-ADR-0091 (menunggu
 * manusia), bukan ke tombol yang ditekan asal.
 */
export async function answerMultiSelectDialog(
  io: PaneIO,
  plan: { pick: number[]; line: string; freeIndex: number | null },
  chunkMs: number,
): Promise<boolean> {
  const want = new Set(plan.pick);
  const state = () => readChoiceDialog(io.capture());

  // 1 · samakan kotak centang dengan rencana. Idempoten: yang sudah benar dilewati, yang tercentang
  //     tapi tak dipilih di-toggle balik — dialog bisa saja sudah disentuh sebelum lead tiba.
  for (const row of state()?.rows ?? []) {
    if (row.checked === null || row.free || row.chat) continue;
    if (row.checked === want.has(row.n)) continue;
    io.literal(String(row.n));
    await io.sleep(DIALOG_SETTLE_MS);
    const after = state()?.rows.find((r) => r.n === row.n);
    if (!after || after.checked !== want.has(row.n)) return false;
  }

  // 2 · prosa lewat kolom bebas, bila memang ada yang perlu disampaikan.
  if (plan.line && plan.freeIndex !== null) {
    let hop = 0;
    while (focusedRow(io.capture()) !== plan.freeIndex && hop < NAV_TRIES) {
      io.down(); await io.sleep(DIALOG_SETTLE_MS); hop++;
    }
    if (focusedRow(io.capture()) !== plan.freeIndex) return false;
    for (const chunk of goalChunks(plan.line)) { io.literal(chunk); await io.sleep(chunkMs); }
    await io.sleep(DIALOG_SETTLE_MS);
    if (!freeTextFilled(io.capture(), plan.freeIndex)) return false;
  }

  // 3 · tombol kirim, lalu Enter. Bukan `Enter` di baris opsi: di sana ia men-toggle.
  let hop = 0;
  while (!state()?.submit.focused && hop < NAV_TRIES) {
    io.down(); await io.sleep(DIALOG_SETTLE_MS); hop++;
  }
  if (!state()?.submit.focused) return false;
  io.enter();
  return true;
}

// Placeholder kolom catatan, keduanya dari biner claude 2.1.220: sebelum kolomnya dibuka
// (`press n to add notes`) dan sesudah dibuka tapi masih kosong (`Add notes on this design…`).
const NOTES_PLACEHOLDER = /^(?:press n to add notes|add notes on this design(?:…|\.\.\.)?)$/i;
const NOTES_LINE = /(?:^|\s)Notes:\s*(.*)$/;

/** Apakah kolom catatan sudah TERISI teks (bukan placeholder-nya lagi)? Cermin `freeTextFilled`. */
export function notesFilled(paneText: string): boolean {
  const lines = paneText.split("\n").map((l) => l.trimEnd());
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = NOTES_LINE.exec(lines[i] ?? "");
    if (!m) continue;
    const v = (m[1] ?? "").trim();
    return v.length > 0 && !NOTES_PLACEHOLDER.test(v);
  }
  return false;
}

/**
 * SPEC-474 · jawab varian dialog yang opsinya ber-`preview`. Layar itu TAK punya baris
 * `Type something.` sama sekali — jalan masuk prosanya kolom catatan yang dibuka tombol `n`.
 *
 * Urutannya mengikat, cermin `answerChoiceDialog`: `n` sebagai keystroke tersendiri (satu
 * karakter, supaya handler daftar mengenalinya) → prosa (tetap ber-`goalChunks`, kolom catatan
 * adalah kolom teks) → `Enter` HANYA sesudah teksnya terbukti mendarat. Tanpa gerbang terakhir
 * itu `Enter` memilih baris tersorot — bug SPEC-452 lewat pintu yang baru.
 *
 * Terukur: catatan sampai ke model VERBATIM meski nilai yang tampil di layar rekap berbunyi
 * `(notes only)` — jadi keputusan lead tetap menyeberang utuh.
 */
export async function answerNotesDialog(io: PaneIO, line: string, chunkMs: number): Promise<boolean> {
  io.literal("n");
  await io.sleep(DIALOG_SETTLE_MS);
  for (const chunk of goalChunks(line)) {
    io.literal(chunk);
    await io.sleep(chunkMs);
  }
  await io.sleep(DIALOG_SETTLE_MS);
  if (!notesFilled(io.capture())) return false;
  io.enter();
  return true;
}

/** Berapa kali layar review dibaca ulang sebelum submit dinyatakan gagal (±2 dtk). */
export const SUBMIT_TRIES = 8;

/**
 * SPEC-474 · tutup rantai dengan menekan `Submit answers` di layar rekap.
 *
 * Nomor barisnya dikirim sebagai keystroke SATU karakter — terukur: satu digit memilih seketika
 * di layar ini, sementara prosa apa pun ditelan tanpa mengubah satu piksel. `Enter` sengaja TIDAK
 * dipakai meski hari ini kebetulan juga men-submit (baris 1 memang yang tersorot): benar karena
 * kebetulan bukan kontrak, dan barisnya bisa bergeser tanpa hanoman tahu.
 */
export async function submitReview(io: PaneIO, submitRow: number): Promise<boolean> {
  io.literal(String(submitRow));
  for (let i = 0; i < SUBMIT_TRIES; i++) {
    await io.sleep(DIALOG_SETTLE_MS);
    if (!readReviewScreen(io.capture())) return true;
  }
  return false;
}
