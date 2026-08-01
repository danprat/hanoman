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
};

export type ChoiceDialog = {
  rows: ChoiceRow[];
  /** Nomor baris kolom jawaban bebas, atau `null` bila dialog ini tak punya (trust, prompt izin). */
  freeIndex: number | null;
  /** Label opsi sebenarnya — tanpa baris bebas & tanpa "Chat about this". */
  options: string[];
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

  const rows: ChoiceRow[] = run.map((r) => ({
    n: r.n, label: r.label,
    free: PLACEHOLDER.test(r.label),
    chat: CHAT_ROW.test(r.label),
  }));
  return {
    rows,
    freeIndex: rows.find((r) => r.free)?.n ?? null,
    options: rows.filter((r) => !r.free && !r.chat).map((r) => r.label),
  };
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
      options: string[]; tabs: DialogTab[]; title: string }
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
  const tabs = s.tabs.map((t) => `${t.answered ? "x" : "o"}${t.header}`).join(",");
  // Judul dipakai bila ada; hanya dialog tanpa tab strip (trust, prompt izin) yang jatuh ke
  // label opsi — dan di sana rantai memang tak pernah berjalan.
  return `q|${tabs}|${s.title || s.options.join("|")}`;
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
