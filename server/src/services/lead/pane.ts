import type { Agent } from "@hanoman/shared";
import { readChoiceDialog } from "../tui-dialog";

// SPEC-409 · ADR-0091 · pintu keputusan #2 (deteksi otomatis) membaca LAYAR sesi. Modul ini murni:
// masuk teks pane, keluar "apakah ini benar-benar pertanyaan" + pertanyaannya. Tanpa I/O, supaya
// AC-9 (marker codex yang sebenarnya selesai wajar) bisa dibuktikan test tanpa tmux.

/** Buang ornamen TUI supaya prosa pertanyaannya terbaca. */
const CLEAN = /[│┃┆┊┌┐└┘├┤┬┴┼─━╭╮╰╯>❯]/g;

const tail = (text: string, lines: number): string[] =>
  text.split("\n").map((l) => l.replace(CLEAN, " ").trimEnd())
    .filter((l) => l.trim()).slice(-lines);

/**
 * AC-9 · codex TIDAK punya event `Notification` — markernya diturunkan dari `Stop`+`UserPromptSubmit`
 * (ADR-0074), jadi ia MENYALA JUGA saat sesi selesai wajar. Penanda di bawah adalah teks yang
 * dipancarkan codex saat selesai, bukan saat bertanya. Ketemu satu → jangan ketik apa pun.
 */
const CODEX_FINISHED = [
  /Goal achieved/i, /Goal unmet/i, /\btokens used\b/i, /\bTo continue this session\b/i,
];

/**
 * Sinyal "sedang bertanya". Sengaja konservatif: pintu ini MENGETIK ke terminal agen yang sedang
 * bekerja, jadi ragu = diam. Yang dianggap sinyal: baris yang berakhir tanda tanya, daftar opsi
 * bernomor, dan kata kerja permintaan putusan yang lazim dipakai agen berbahasa Indonesia/Inggris.
 */
const ASK_SIGNALS = [
  /\?\s*$/m,
  /^\s*\[?\d+[).\]]\s+\S/m,
  /\b(pilih|apakah|haruskah|mana yang|opsi|which|should i|do you want|proceed\?)\b/i,
];

export type PaneRead = {
  asking: boolean;
  question: string;
  reason: string;
  /**
   * SPEC-452 · label opsi bila layarnya dialog pilihan (`AskUserQuestion`). Disodorkan ke
   * `leadPrompt` lewat `options` — tempat yang sudah ada sejak ADR-0091 dan selama ini tak pernah
   * diisi pintu deteksi, sehingga lead cuma melihat opsinya terkubur di dalam teks layar. Kosong
   * berarti "bukan dialog", bukan "dialog tanpa opsi".
   */
  choices: string[];
};

/**
 * Turunkan pertanyaan dari layar pane.
 *
 * claude: marker keputusan lahir dari hook `Notification` yang hanya menembak saat agen benar-benar
 * meminta masukan — markernya dipercaya, isi layar dipakai sebagai pertanyaannya.
 *
 * codex: marker tak bisa dipercaya sendirian (lihat CODEX_FINISHED), jadi butuh sinyal bertanya
 * yang eksplisit DAN tak ada penanda selesai.
 */
export function readPaneQuestion(text: string, agent: Agent): PaneRead {
  const lines = tail(text, 40);
  const body = lines.join("\n").trim();
  // SPEC-452 · dibaca dari teks ASLI, bukan dari `body`: `CLEAN` membuang `❯` dan garis kotak yang
  // ikut menyusun layar dialog, dan parser dialog memang menunggu bentuknya apa adanya.
  const choices = readChoiceDialog(text)?.options ?? [];
  if (!body) return { asking: false, question: "", reason: "layar kosong", choices };
  const question = tail(text, 25).join("\n").trim();
  if (agent === "codex") {
    const finished = CODEX_FINISHED.find((re) => re.test(body));
    if (finished) return { asking: false, question, reason: "sesi codex selesai wajar (ADR-0074)", choices };
    if (!ASK_SIGNALS.some((re) => re.test(body)))
      return { asking: false, question, reason: "tak ada sinyal pertanyaan di layar codex", choices };
  }
  return { asking: true, question, reason: "", choices };
}
