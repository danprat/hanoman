import { describe, it, expect } from "vitest";
import { readChoiceDialog, freeTextFilled, answerChoiceDialog, type PaneIO } from "../src/services/tui-dialog";

// SPEC-452 · dialog pilihan claude (`AskUserQuestion`) BUKAN kolom teks: burst apa pun yang lebih
// dari satu karakter ditelan, dan `Enter` memilih baris yang sedang disorot. Parser ini yang
// membedakan layar dialog dari kolom chat, dan menunjukkan di nomor berapa kolom jawaban bebasnya.
//
// Fixture di bawah adalah tangkapan `capture-pane -p -J` sungguhan dari claude 2.1.220, bukan
// karangan — termasuk lebar baris, garis pemisah, dan footer chord-nya.

const ASKQ_TIGA_OPSI = `
❯ Pakai AskUserQuestion sekali lagi: tanya saya pilih strategi cache in-memory,
  redis, atau tanpa cache. Jangan lakukan apa pun lain.
────────────────────────────────────────────────────────────────────────────────
 ☐ Strategi Cache

Mau pakai strategi cache yang mana?

❯ 1. In-memory
     Cache disimpan di memori proses
  2. Redis
     Cache menggunakan Redis
  3. Tanpa cache
     Tidak menggunakan caching
  4. Type something.
────────────────────────────────────────────────────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`;

const ASKQ_DUA_OPSI = `
 ☐ Versi Node

Mau target Node versi berapa?

❯ 1. Node 20
     Menargetkan Node.js versi 20 (LTS)
  2. Node 22
     Menargetkan Node.js versi 22
  3. Type something.
────────────────────────────────────────────────────────────────────────────────
  4. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`;

/** Layar yang sama sesudah baris kolom-bebas difokuskan dan diketik — labelnya jadi teks kita. */
const ASKQ_TIGA_OPSI_TERISI = ASKQ_TIGA_OPSI
  .replace("  4. Type something.", "❯ 4. Tanpa cache dulu; SQLite lokal sudah cukup cepat dan cache\n     menambah state yang harus di-invalidate.")
  .replace("Enter to select · ↑/↓ to navigate · Esc to cancel",
    "Enter to select · ↑/↓ to navigate · ctrl+g to edit in Vim · Esc to cancel");

const KOLOM_CHAT = `
⏺ Kamu memilih Node 20.

✻ Sautéed for 4s

────────────────────────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents
                                                             ◉ xhigh · /effort
`;

// Dialog trust & prompt izin TIDAK punya baris jawaban bebas. Di sana `Enter` memilih baris 1 yang
// memang berarti "ya" — perilaku hari ini benar dan tak boleh ikut berubah.
const DIALOG_TRUST = `
 Quick safety check: Is this a project you created or one you trust?

 ❯ 1. Yes, I trust this folder
   2. No, exit

 Enter to confirm · Esc to cancel
`;

describe("readChoiceDialog · mengenali dialog pilihan", () => {
  it("membaca deret baris bernomor dan nomor kolom jawaban bebasnya", () => {
    const d = readChoiceDialog(ASKQ_TIGA_OPSI);
    expect(d).not.toBeNull();
    expect(d!.rows.map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
    expect(d!.freeIndex).toBe(4);
  });

  it("kolom jawaban bebas selalu di nomor jumlah_opsi + 1", () => {
    expect(readChoiceDialog(ASKQ_DUA_OPSI)!.freeIndex).toBe(3);
  });

  it("menyodorkan LABEL opsi saja — baris bebas & 'Chat about this' bukan pilihan", () => {
    expect(readChoiceDialog(ASKQ_TIGA_OPSI)!.options).toEqual(["In-memory", "Redis", "Tanpa cache"]);
  });

  it("mengabaikan baris keterangan di bawah tiap opsi", () => {
    const labels = readChoiceDialog(ASKQ_DUA_OPSI)!.rows.map((r) => r.label);
    expect(labels).not.toContain("Menargetkan Node.js versi 22");
  });

  // Kolom chat biasa TIDAK boleh terbaca sebagai dialog: di sana jalur lama (prosa + Enter) benar,
  // dan menukarnya dengan ketikan nomor akan merusak satu-satunya jalur yang hari ini bekerja.
  it("diam untuk kolom chat biasa", () => {
    expect(readChoiceDialog(KOLOM_CHAT)).toBeNull();
  });

  it("diam untuk layar kosong", () => {
    expect(readChoiceDialog("   \n\n   ")).toBeNull();
  });

  // Fail-closed: dialog tanpa kolom bebas tetap dikenali sebagai dialog, tapi tanpa nomor untuk
  // diketik — pemanggil jatuh ke perilaku hari ini, bukan menebak baris.
  it("mengenali dialog tanpa kolom jawaban bebas dan tidak mengarang nomornya", () => {
    const d = readChoiceDialog(DIALOG_TRUST);
    expect(d).not.toBeNull();
    expect(d!.freeIndex).toBeNull();
    expect(d!.options).toEqual(["Yes, I trust this folder", "No, exit"]);
  });

  // Scrollback memuat dialog-dialog lama. Yang berlaku adalah yang PALING BAWAH.
  it("memakai deret bernomor terakhir saat scrollback memuat dialog lama", () => {
    const d = readChoiceDialog(`${ASKQ_DUA_OPSI}\n⏺ Kamu memilih Node 20.\n${ASKQ_TIGA_OPSI}`);
    expect(d!.freeIndex).toBe(4);
    expect(d!.options).toEqual(["In-memory", "Redis", "Tanpa cache"]);
  });

  it("mengenali placeholder multiSelect yang tanpa titik", () => {
    const d = readChoiceDialog(ASKQ_DUA_OPSI.replace("Type something.", "Type something"));
    expect(d!.freeIndex).toBe(3);
  });
});

describe("freeTextFilled · gerbang sebelum Enter", () => {
  // Tanpa gerbang ini, `Enter` yang terlanjur ditekan memilih baris yang sedang disorot —
  // persis bug SPEC-452 yang sedang diperbaiki.
  it("false selama baris bebas masih menampilkan placeholder-nya", () => {
    expect(freeTextFilled(ASKQ_TIGA_OPSI, 4)).toBe(false);
  });

  it("true begitu teks benar-benar mendarat di baris bebas", () => {
    expect(freeTextFilled(ASKQ_TIGA_OPSI_TERISI, 4)).toBe(true);
  });

  it("false bila dialognya sudah tak ada di layar", () => {
    expect(freeTextFilled(KOLOM_CHAT, 4)).toBe(false);
  });

  it("false bila nomor barisnya tak ada di dialog", () => {
    expect(freeTextFilled(ASKQ_TIGA_OPSI_TERISI, 9)).toBe(false);
  });
});

// ── answerChoiceDialog ──────────────────────────────────────────────────────────────────────────
//
// TUI palsu di bawah meniru semantik yang DIUKUR pada claude 2.1.220 (§3.2/§3.3 dokumen audit),
// bukan semantik yang diandaikan:
//   · masukan sepanjang TEPAT satu karakter dibandingkan dengan nomor baris → hotkey;
//   · nomor baris kolom-bebas hanya MEMINDAHKAN FOKUS ke kolom itu (tak langsung memilih);
//   · burst lebih dari satu karakter saat fokus masih di daftar → DITELAN tanpa jejak;
//   · `Enter` saat fokus masih di daftar → memilih baris yang sedang disorot (baris 1).
function fakeDialogTui(freeIndex: number, opts: { swallow?: boolean } = {}) {
  const literals: string[] = [];
  let focused = false;
  let typed = "";
  let submitted: string | null = null;
  let pickedRow: number | null = null;
  const render = () => [
    "Mau pakai strategi cache yang mana?",
    "",
    "❯ 1. In-memory",
    "  2. Redis",
    "  3. Tanpa cache",
    `  ${freeIndex}. ${typed || "Type something."}`,
    "────────────────────────────────",
    `  ${freeIndex + 1}. Chat about this`,
    "",
    "Enter to select · ↑/↓ to navigate · Esc to cancel",
  ].join("\n");
  const io: PaneIO = {
    capture: () => render(),
    literal: (s) => {
      literals.push(s);
      if (opts.swallow) return;                      // pane yang tak pernah menerima apa pun
      if (s.length === 1 && /\d/.test(s)) {
        if (Number(s) === freeIndex) { focused = true; return; }
        pickedRow = Number(s);                        // opsi biasa: terpilih SEKETIKA
        return;
      }
      if (focused) typed += s;                        // kolom teks menerima burst apa adanya
    },
    enter: () => { if (focused) submitted = typed; else pickedRow = 1; },
    sleep: async () => {},
  };
  return { io, literals, get submitted() { return submitted; }, get pickedRow() { return pickedRow; } };
}

describe("answerChoiceDialog · menjawab seperti manusia", () => {
  const JAWABAN = "Tanpa cache dulu; SQLite lokal sudah cukup cepat.";

  it("mengetik nomor kolom bebas sebagai keystroke TERSENDIRI sebelum prosanya", async () => {
    const t = fakeDialogTui(4);
    await answerChoiceDialog(t.io, 4, JAWABAN, 0);
    // Menempelkan nomor pada prosa membuat burst-nya > 1 karakter → hotkey tak pernah cocok.
    expect(t.literals[0]).toBe("4");
  });

  it("menyerahkan prosa lead UTUH ke claude, lalu menekan Enter", async () => {
    const t = fakeDialogTui(4);
    expect(await answerChoiceDialog(t.io, 4, JAWABAN, 0)).toBe(true);
    expect(t.submitted).toBe(JAWABAN);
    expect(t.pickedRow).toBeNull();                   // bukan "opsi 1 karena kebetulan disorot"
  });

  it("memotong jawaban panjang seperti arming goal (ADR-0085) tanpa kehilangan satu karakter", async () => {
    const panjang = `${"a".repeat(700)} ekor`;
    const t = fakeDialogTui(4);
    expect(await answerChoiceDialog(t.io, 4, panjang, 0)).toBe(true);
    expect(t.literals.slice(1).every((c) => c.length <= 500)).toBe(true);
    expect(t.literals.length).toBeGreaterThan(2);
    expect(t.submitted).toBe(panjang);
  });

  // Gerbang terpenting spec ini: Enter yang ditekan pada dialog yang tak menerima teks kita akan
  // memilih baris tersorot — yaitu bug SPEC-452 itu sendiri, hanya lewat jalur baru.
  it("TIDAK menekan Enter bila teks tak mendarat di kolom bebas", async () => {
    const t = fakeDialogTui(4, { swallow: true });
    expect(await answerChoiceDialog(t.io, 4, JAWABAN, 0)).toBe(false);
    expect(t.pickedRow).toBeNull();
    expect(t.submitted).toBeNull();
  });
});
