# Keputusan lead berantai sampai submit — Implementation Plan (SPEC-474)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hanoman-lead menjawab dialog `AskUserQuestion` berantai (2–4 pertanyaan dalam satu tool call) sampai dialognya benar-benar ter-submit, dalam satu putaran deteksi, dan tak pernah meninggalkan sesi menggantung tanpa gejala.

**Architecture:** `services/tui-dialog.ts` tumbuh dari “satu bentuk dialog” jadi **pembaca layar dialog** (`readDialogScreen` → `question | review`) berikut dua penulis baru (`answerNotesDialog`, `submitReview`); `services/pty.ts` merutekan `sendToPane` menurut bentuk layar itu dan menambah `submitPaneDialog`; `services/lead/detect.ts` menggerakkan **rantai**: satu keputusan lead per pertanyaan, submit mekanis tanpa agen, marker keputusan dikosongkan **hanya** di ujung rantai.

**Tech Stack:** TypeScript strict · Fastify server · Vitest (server package, `--no-file-parallelism` wajib) · tmux `send-keys`/`capture-pane` · tanpa dependensi baru.

## Global Constraints

- Spec-of-record: [`docs/superpowers/specs/2026-08-01-spec-474-keputusan-lead-berantai-design.md`](../specs/2026-08-01-spec-474-keputusan-lead-berantai-design.md). Semua pengukuran M1–M9 ada di sana.
- **Tanpa ADR baru, tanpa perubahan skema/migration, tanpa endpoint baru, tanpa knob baru.** ADR-0091 ditegakkan; ADR-0037 (guardrail dicabut) & ADR-0074 tetap utuh.
- **Fail-closed di setiap ragu** (warisan SPEC-452): layar yang tak dikenali → jalur lama persis; `Enter` hanya sesudah teks terbukti mendarat; dialog **tanpa tab strip** (trust, prompt izin) tak disentuh sama sekali.
- **`MAX_CHAIN_STEPS = 6`** adalah **konstanta modul**, bukan konfigurasi (cermin `LEAD_ACTIONS`, ADR-0091). Kontrak tool `AskUserQuestion` = 1–4 pertanyaan.
- **Satu rantai = satu jawaban otomatis** terhadap `cfg.maxAutoAnswers` (default 3).
- Fixture layar WAJIB tangkapan `capture-pane -p -J` nyata dari claude 2.1.220 seperti tertulis di design doc — bukan karangan.
- Bahasa komentar & pesan: Indonesia, mengikuti berkas sekitarnya.
- Verifikasi ber-scope perubahan saja. Perintah test di plan ini dijalankan **dari root worktree**:
  `pnpm vitest run --no-file-parallelism <path…>` (bila `pnpm` gagal lewat proxy: `./node_modules/.bin/vitest run --no-file-parallelism <path…>`).

## File Structure

| Berkas | Tanggung jawab sesudah plan ini |
|---|---|
| `server/src/services/tui-dialog.ts` (modify) | **Pembacaan murni layar dialog** (`readChoiceDialog` lama + `readReviewScreen`, `readDialogScreen`, `dialogKey`, `notesFilled`) dan **penulisan lewat `PaneIO`** (`answerChoiceDialog` lama + `answerNotesDialog`, `submitReview`). |
| `server/src/services/pty.ts` (modify) | Merutekan satu ketikan ke bentuk layar yang benar; menambah `submitPaneDialog(id)`. Tetap nol dependensi DB. |
| `server/src/services/lead/detect.ts` (modify) | Menggerakkan rantai: decide → jawab → tunggu layar berganti → ulang; submit mekanis; marker & penghitung di ujung rantai. |
| `server/test/tui-dialog.test.ts` (modify) | Fixture nyata + unit parser & penulis. |
| `server/test/pty.test.ts` (modify) | Routing `sendToPane` di atas tmux sungguhan. |
| `server/test/fixtures/fake-review.sh` (create) | Pane yang menampilkan layar review (tanpa footer chord). |
| `server/test/fixtures/fake-notes-dialog.sh` (create) | Pane varian preview (tanpa baris `Type something.`, catatan lewat `n`). |
| `server/test/lead-detect.test.ts` (modify) | Rantai lengkap, rantai putus, kompatibilitas jalur lama. |
| `internal/skills/hanoman/SKILL.md` (modify) | Butir permanen SPEC-474. |

---

### Task 1: Pembaca layar dialog — tab strip, layar review, kunci layar

**Files:**
- Modify: `server/src/services/tui-dialog.ts`
- Test: `server/test/tui-dialog.test.ts`

**Interfaces:**
- Consumes: `readChoiceDialog`, `ChoiceRow`, `PaneIO`, `DIALOG_SETTLE_MS` (sudah ada).
- Produces:
  ```ts
  export type DialogTab = { header: string; answered: boolean };
  export type DialogScreen =
    | { kind: "question"; rows: ChoiceRow[]; freeIndex: number | null; notes: boolean;
        options: string[]; tabs: DialogTab[] }
    | { kind: "review"; submitRow: number };
  export function readReviewScreen(paneText: string): { submitRow: number } | null;
  export function readDialogScreen(paneText: string): DialogScreen | null;
  export function dialogKey(paneText: string): string;
  ```

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/tui-dialog.test.ts`, tepat sesudah blok fixture yang sudah ada:

```ts
import { readDialogScreen, readReviewScreen, dialogKey } from "../src/services/tui-dialog";

// SPEC-474 · tangkapan NYATA claude 2.1.220 (capture-pane -p -J), dua pertanyaan satu tool call.
const RANTAI_Q1 = `
────────────────────────────────────────────────────────────────────────
←  ☐ Warna  ☐ Ukuran  ✔ Submit  →

Pilih warna tema?

❯ 1. Merah
     tema merah
  2. Biru
     tema biru
  3. Type something.
────────────────────────────────────────────────────────────────────────
  4. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel
`;

const RANTAI_Q2 = `
────────────────────────────────────────────────────────────────────────
←  ☒ Warna  ☐ Ukuran  ✔ Submit  →

Pilih ukuran font?

❯ 1. Kecil
     font kecil
  2. Besar
     font besar
  3. Type something.
────────────────────────────────────────────────────────────────────────
  4. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel
`;

// Layar review TIDAK punya baris footer chord sama sekali — itulah sebabnya parser SPEC-452
// tak pernah melihatnya (M3).
const RANTAI_REVIEW = `
────────────────────────────────────────────────────────────────────────
←  ☒ Warna  ☒ Ukuran  ✔ Submit  →

Review your answers

 ● Pilih warna tema?
   → Merah, karena kontrasnya paling tinggi di layar terang.
 ● Pilih ukuran font?
   → Besar, supaya terbaca dari jauh.

Ready to submit your answers?

❯ 1. Submit answers
  2. Cancel
`;

// Varian ber-preview: opsi saja yang bernomor, tanpa baris "Type something.",
// "Chat about this" TANPA nomor, catatan lewat tombol `n` (M7).
const DIALOG_PREVIEW = `
────────────────────────────────────────────────────────────────────────
←  ☐ Loop  ☐ Nama  ✔ Submit  →

Pakai for atau map?

❯ 1. for                          ┌────────────────────────────┐
  2. map                          │ for (const x of xs) f(x)   │
                                  └────────────────────────────┘

                                  Notes: press n to add notes

────────────────────────────────────────────────────────────────────────
  Chat about this

Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel
`;

describe("readDialogScreen · bentuk layar dialog (SPEC-474)", () => {
  it("membaca tab strip berikut status terjawabnya", () => {
    const s = readDialogScreen(RANTAI_Q1);
    expect(s?.kind).toBe("question");
    expect(s!.kind === "question" && s!.tabs).toEqual([
      { header: "Warna", answered: false },
      { header: "Ukuran", answered: false },
    ]);
  });

  it("membaca ☒ sebagai pertanyaan yang sudah dijawab", () => {
    const s = readDialogScreen(RANTAI_Q2);
    expect(s!.kind === "question" && s!.tabs.map((t) => t.answered)).toEqual([true, false]);
  });

  // Dialog satu pertanyaan (SPEC-452) tetap terbaca; strip-nya cuma satu tab tanpa Submit.
  it("dialog satu pertanyaan tetap terbaca dan kolom bebasnya tak bergeser", () => {
    const s = readDialogScreen(ASKQ_TIGA_OPSI);
    expect(s!.kind === "question" && s!.freeIndex).toBe(4);
    expect(s!.kind === "question" && s!.tabs).toEqual([{ header: "Strategi Cache", answered: false }]);
  });

  it("mengenali layar review meski TANPA footer chord", () => {
    expect(readDialogScreen(RANTAI_REVIEW)).toEqual({ kind: "review", submitRow: 1 });
    expect(readReviewScreen(RANTAI_REVIEW)).toEqual({ submitRow: 1 });
  });

  // Scrollback memuat layar review lama; yang berlaku adalah layar PALING BAWAH.
  it("dialog baru di bawah review lama tetap terbaca sebagai pertanyaan", () => {
    const s = readDialogScreen(`${RANTAI_REVIEW}\n⏺ Selesai.\n${RANTAI_Q1}`);
    expect(s?.kind).toBe("question");
  });

  it("review di bawah dialog lama tetap terbaca sebagai review", () => {
    expect(readDialogScreen(`${RANTAI_Q1}\n${RANTAI_REVIEW}`)?.kind).toBe("review");
  });

  it("menandai varian preview sebagai dialog ber-kolom-catatan, bukan dialog tanpa jalan masuk", () => {
    const s = readDialogScreen(DIALOG_PREVIEW);
    expect(s!.kind === "question" && s!.freeIndex).toBeNull();
    expect(s!.kind === "question" && s!.notes).toBe(true);
    expect(s!.kind === "question" && s!.options).toEqual(["for", "map"]);
  });

  // Dialog trust TIDAK punya tab strip dan TIDAK punya kolom catatan → pemanggil wajib
  // jatuh ke jalur lama (Enter = baris 1 = "ya").
  it("dialog trust tetap tanpa tab strip dan tanpa kolom catatan", () => {
    const s = readDialogScreen(DIALOG_TRUST);
    expect(s!.kind === "question" && s!.tabs).toEqual([]);
    expect(s!.kind === "question" && s!.notes).toBe(false);
  });

  it("diam untuk kolom chat biasa", () => {
    expect(readDialogScreen(KOLOM_CHAT)).toBeNull();
  });
});

describe("dialogKey · kunci anti-loop", () => {
  it("berubah saat rantai maju ke pertanyaan berikutnya", () => {
    expect(dialogKey(RANTAI_Q1)).not.toBe(dialogKey(RANTAI_Q2));
  });

  it("TIDAK berubah saat kolom bebas terisi tanpa layar berpindah", () => {
    expect(dialogKey(ASKQ_TIGA_OPSI)).toBe(dialogKey(ASKQ_TIGA_OPSI_TERISI));
  });

  it("membedakan review dari pertanyaan dan dari layar bukan-dialog", () => {
    expect(dialogKey(RANTAI_REVIEW)).toBe("review");
    expect(dialogKey(KOLOM_CHAT)).toBe("none");
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `pnpm vitest run --no-file-parallelism server/test/tui-dialog.test.ts`
Expected: FAIL — `readDialogScreen is not a function` (import tak ada).

- [ ] **Step 3: Implementasi minimal**

Di `server/src/services/tui-dialog.ts`, tambahkan sesudah `readChoiceDialog`:

```ts
/** Satu tab pertanyaan di strip atas dialog berantai: `☐ Warna` (belum) / `☒ Warna` (sudah). */
export type DialogTab = { header: string; answered: boolean };

/**
 * SPEC-474 · bentuk layar dialog. `question` = ada yang harus dijawab; `review` = semua pertanyaan
 * sudah dijawab dan tinggal ditekan submit-nya.
 */
export type DialogScreen =
  | { kind: "question"; rows: ChoiceRow[]; freeIndex: number | null; notes: boolean;
      options: string[]; tabs: DialogTab[] }
  | { kind: "review"; submitRow: number };

// Layar review TIDAK punya footer chord (terukur: 40 baris pane, delapan baris terakhir kosong),
// jadi ia tak bisa dikenali lewat FOOTER seperti dialog lain. Dua penanda di bawah dipakai
// bersama-sama supaya kalimat "Review your answers" yang kebetulan lewat di transkrip tak cukup.
const REVIEW_PROMPT = /^\s*ready to submit your answers\?\s*$/i;
const SUBMIT_ROW = /^\s*[❯>›]?\s*(\d{1,2})\.\s+submit answers\s*$/i;
// Varian ber-preview tak punya baris kolom-bebas; jalan masuk prosanya kolom catatan (tombol `n`).
const NOTES_FOOTER = /\bn to add notes\b/i;
const TAB_BOX = /^([☐☒])\s*(.+)$/;

const lastIndexOf = (lines: string[], re: RegExp): number => {
  for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i] ?? "")) return i;
  return -1;
};

/**
 * Tab strip dialog `AskUserQuestion`: `←  ☐ Warna  ☐ Ukuran  ✔ Submit  →`.
 *
 * Kosong berarti layar ini BUKAN `AskUserQuestion` (dialog trust & prompt izin tak punya strip) —
 * pembeda yang memisahkan "boleh dijawab bebas" dari "Enter = baris 1 = ya".
 */
function readTabs(lines: string[]): DialogTab[] {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (!/[☐☒]/.test(line)) continue;
    const tabs: DialogTab[] = [];
    for (const tok of line.split(/\s{2,}/)) {
      const m = TAB_BOX.exec(tok.trim());
      if (m) tabs.push({ header: (m[2] ?? "").trim(), answered: m[1] === "☒" });
    }
    if (tabs.length) return tabs;
  }
  return [];
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
 * Bentuk layar dialog yang sedang tampil. `null` = bukan layar dialog (pemanggil harus berperilaku
 * persis seperti sebelum SPEC-452).
 *
 * Urutannya penting: layar review dinilai lebih dulu, TAPI hanya bila ia berada DI BAWAH footer
 * dialog terakhir — scrollback memuat rekap-rekap lama, dan yang berlaku selalu yang paling bawah.
 */
export function readDialogScreen(paneText: string): DialogScreen | null {
  const lines = paneText.split("\n").map((l) => l.trimEnd());
  const footer = lastIndexOf(lines, FOOTER);
  const reviewAt = lastIndexOf(lines, REVIEW_PROMPT);
  if (reviewAt > footer) {
    const review = readReviewScreen(paneText);
    if (review) return { kind: "review", submitRow: review.submitRow };
  }
  const d = readChoiceDialog(paneText);
  if (!d) return null;
  return {
    kind: "question", rows: d.rows, freeIndex: d.freeIndex, options: d.options,
    notes: d.freeIndex === null && NOTES_FOOTER.test(lines[footer] ?? ""),
    tabs: readTabs(lines.slice(0, footer)),
  };
}

/**
 * Kunci layar untuk gerbang anti-loop & penanda "rantai sudah maju".
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
  return `q|${tabs}|${s.options.join("|")}`;
}
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `pnpm vitest run --no-file-parallelism server/test/tui-dialog.test.ts`
Expected: PASS — seluruh test lama SPEC-452 tetap hijau, test SPEC-474 baru hijau.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/tui-dialog.ts server/test/tui-dialog.test.ts
git commit -m "feat(474): baca bentuk layar dialog — tab strip, layar review, kunci anti-loop"
```

---

### Task 2: Penulis layar — jawab lewat kolom catatan, tekan submit

**Files:**
- Modify: `server/src/services/tui-dialog.ts`
- Test: `server/test/tui-dialog.test.ts`

**Interfaces:**
- Consumes: `PaneIO`, `DIALOG_SETTLE_MS`, `goalChunks`, `readReviewScreen` (Task 1).
- Produces:
  ```ts
  export function notesFilled(paneText: string): boolean;
  export async function answerNotesDialog(io: PaneIO, line: string, chunkMs: number): Promise<boolean>;
  export async function submitReview(io: PaneIO, submitRow: number): Promise<boolean>;
  export const SUBMIT_TRIES: number;
  ```

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/tui-dialog.test.ts`:

```ts
import { answerNotesDialog, submitReview, notesFilled } from "../src/services/tui-dialog";

// TUI palsu varian preview. Semantik yang ditiru semuanya TERUKUR (M7/M8):
//   · `n` (satu karakter) membuka kolom catatan;
//   · sebelum dibuka, burst apa pun ditelan tanpa jejak;
//   · `Enter` saat fokus masih di daftar memilih baris tersorot (baris 1).
function fakeNotesTui(opts: { deaf?: boolean } = {}) {
  const literals: string[] = [];
  let open = false;
  let typed = "";
  let submitted: string | null = null;
  let pickedRow: number | null = null;
  const render = () => [
    "←  ☐ Loop  ☐ Nama  ✔ Submit  →",
    "",
    "Pakai for atau map?",
    "",
    "❯ 1. for",
    "  2. map",
    "",
    `                    Notes: ${open ? (typed || "Add notes on this design…") : "press n to add notes"}`,
    "────────────────────────────────",
    "  Chat about this",
    "",
    "Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel",
  ].join("\n");
  const io: PaneIO = {
    capture: () => render(),
    literal: (s) => {
      literals.push(s);
      if (opts.deaf) return;
      if (!open) { if (s === "n") open = true; return; }   // daftar menelan burst > 1 karakter
      typed += s;
    },
    enter: () => { if (open) submitted = typed; else pickedRow = 1; },
    sleep: async () => {},
  };
  return { io, literals, get submitted() { return submitted; }, get pickedRow() { return pickedRow; } };
}

// TUI palsu layar review: satu digit memilih seketika (M4), prosa ditelan.
function fakeReviewTui(opts: { deaf?: boolean } = {}) {
  let done = false;
  const literals: string[] = [];
  const render = () => done
    ? "⏺ User answered Claude's questions:\n"
    : ["←  ☒ Warna  ☒ Ukuran  ✔ Submit  →", "", "Review your answers", "",
       "Ready to submit your answers?", "", "❯ 1. Submit answers", "  2. Cancel"].join("\n");
  const io: PaneIO = {
    capture: () => render(),
    literal: (s) => { literals.push(s); if (!opts.deaf && s === "1") done = true; },
    enter: () => { throw new Error("submit tak boleh memakai Enter"); },
    sleep: async () => {},
  };
  return { io, literals, get done() { return done; } };
}

describe("answerNotesDialog · varian preview (SPEC-474)", () => {
  const JAWABAN = "Pakai map karena ekspresif dan tanpa efek samping.";

  it("membuka kolom catatan dengan `n` sebagai keystroke tersendiri sebelum prosanya", async () => {
    const t = fakeNotesTui();
    await answerNotesDialog(t.io, JAWABAN, 0);
    expect(t.literals[0]).toBe("n");
  });

  it("menyerahkan prosa lead UTUH lalu menekan Enter", async () => {
    const t = fakeNotesTui();
    expect(await answerNotesDialog(t.io, JAWABAN, 0)).toBe(true);
    expect(t.submitted).toBe(JAWABAN);
    expect(t.pickedRow).toBeNull();          // bukan "opsi 1 karena kebetulan disorot"
  });

  it("TIDAK menekan Enter bila kolom catatan tak pernah menerima teks", async () => {
    const t = fakeNotesTui({ deaf: true });
    expect(await answerNotesDialog(t.io, JAWABAN, 0)).toBe(false);
    expect(t.pickedRow).toBeNull();
  });

  it("memotong jawaban panjang seperti arming goal (ADR-0085)", async () => {
    const t = fakeNotesTui();
    const panjang = `${"a".repeat(700)} ekor`;
    expect(await answerNotesDialog(t.io, panjang, 0)).toBe(true);
    expect(t.literals.slice(1).every((c) => c.length <= 500)).toBe(true);
    expect(t.submitted).toBe(panjang);
  });
});

describe("notesFilled · gerbang sebelum Enter", () => {
  it("false selama kolom catatan masih menampilkan placeholder-nya", () => {
    expect(notesFilled("   Notes: press n to add notes")).toBe(false);
    expect(notesFilled("   Notes: Add notes on this design…")).toBe(false);
  });

  it("true begitu teks benar-benar mendarat", () => {
    expect(notesFilled("   Notes: Pakai map karena ekspresif.")).toBe(true);
  });
});

describe("submitReview · menutup rantai", () => {
  it("menekan nomor baris Submit sebagai SATU karakter, tanpa Enter", async () => {
    const t = fakeReviewTui();
    expect(await submitReview(t.io, 1)).toBe(true);
    expect(t.literals).toEqual(["1"]);
    expect(t.done).toBe(true);
  });

  it("false bila layar review tak kunjung pergi", async () => {
    const t = fakeReviewTui({ deaf: true });
    expect(await submitReview(t.io, 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `pnpm vitest run --no-file-parallelism server/test/tui-dialog.test.ts`
Expected: FAIL — `answerNotesDialog is not a function`.

- [ ] **Step 3: Implementasi minimal**

Di `server/src/services/tui-dialog.ts`, tambahkan sesudah `answerChoiceDialog`:

```ts
// Placeholder kolom catatan, keduanya dari biner claude 2.1.220: sebelum dibuka
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
 * SPEC-474 · jawab varian dialog yang opsinya ber-`preview`. Layarnya TAK punya baris
 * `Type something.`; jalan masuk prosanya kolom catatan yang dibuka tombol `n`.
 *
 * Urutannya mengikat, sama seperti `answerChoiceDialog`: `n` sebagai keystroke tersendiri →
 * prosa (tetap ber-`goalChunks`) → `Enter` HANYA sesudah teksnya terbukti mendarat. Terukur:
 * catatan yang terkirim sampai ke model verbatim meski nilai yang tampil di layar review
 * berbunyi `(notes only)`.
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
 * SPEC-474 · tutup rantai dengan menekan `Submit answers`.
 *
 * Nomor barisnya dikirim sebagai keystroke SATU karakter — terukur: satu digit memilih seketika
 * di layar ini, sementara prosa ditelan tanpa jejak. `Enter` sengaja TIDAK dipakai meski hari ini
 * kebetulan juga men-submit (baris 1 yang tersorot): kebenaran karena kebetulan bukan kontrak.
 */
export async function submitReview(io: PaneIO, submitRow: number): Promise<boolean> {
  io.literal(String(submitRow));
  for (let i = 0; i < SUBMIT_TRIES; i++) {
    await io.sleep(DIALOG_SETTLE_MS);
    if (!readReviewScreen(io.capture())) return true;
  }
  return false;
}
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `pnpm vitest run --no-file-parallelism server/test/tui-dialog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/tui-dialog.ts server/test/tui-dialog.test.ts
git commit -m "feat(474): jawab dialog ber-preview lewat kolom catatan + tekan Submit answers"
```

---

### Task 3: `pty.ts` merutekan ketikan menurut bentuk layar

**Files:**
- Modify: `server/src/services/pty.ts` (fungsi `sendToPane`, ±baris 490)
- Create: `server/test/fixtures/fake-review.sh`
- Create: `server/test/fixtures/fake-notes-dialog.sh`
- Test: `server/test/pty.test.ts` (blok `describe("sendToPane · dialog pilihan (SPEC-452)")`)

**Interfaces:**
- Consumes: `readDialogScreen`, `answerNotesDialog`, `submitReview` (Task 1–2).
- Produces: `export async function submitPaneDialog(id: string): Promise<boolean>`.

- [ ] **Step 1: Tulis fixture pane**

`server/test/fixtures/fake-review.sh`:

```sh
#!/bin/sh
# SPEC-474 · pane yang menampilkan LAYAR REVIEW sebuah dialog berantai. Salinan tangkapan
# `capture-pane` nyata dari claude 2.1.220 — termasuk yang paling penting: layar ini TIDAK
# punya baris footer chord, jadi parser SPEC-452 tak pernah melihatnya.
#
# Seperti fake-dialog.sh ia hanya meng-echo: yang diuji adalah apa yang benar-benar DIKIRIM
# hanoman (satu digit, tanpa Enter).
cat <<'SCREEN'
←  ☒ Warna  ☒ Ukuran  ✔ Submit  →

Review your answers

 ● Pilih warna tema?
   → Merah, karena kontrasnya paling tinggi.

Ready to submit your answers?

❯ 1. Submit answers
  2. Cancel
SCREEN
exec cat
```

`server/test/fixtures/fake-notes-dialog.sh`:

```sh
#!/bin/sh
# SPEC-474 · pane varian `AskUserQuestion` yang opsinya ber-`preview`: hanya opsi yang bernomor,
# TANPA baris "Type something.", "Chat about this" tanpa nomor, catatan lewat tombol `n`.
cat <<'SCREEN'
←  ☐ Loop  ☐ Nama  ✔ Submit  →

Pakai for atau map?

❯ 1. for
  2. map

                    Notes: press n to add notes

  Chat about this

Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel
SCREEN
exec cat
```

Keduanya `chmod +x`.

- [ ] **Step 2: Tulis test yang gagal**

Di `server/test/pty.test.ts`, tambahkan di dalam `describe("sendToPane · dialog pilihan (SPEC-452)")`
(dan tambahkan konstanta path fixture di sebelah `FAKE_DIALOG` yang sudah ada):

```ts
const FAKE_REVIEW = resolve(import.meta.dirname, "fixtures/fake-review.sh");
const FAKE_NOTES = resolve(import.meta.dirname, "fixtures/fake-notes-dialog.sh");

// SPEC-474 · layar review adalah langkah mekanis: yang dikirim satu digit, TANPA prosa dan
// TANPA Enter. Fixture cuma meng-echo, jadi yang terbaca di pane = yang benar-benar dikirim.
it("menekan nomor Submit answers — bukan prosa — saat pane menampilkan layar review", async () => {
  const id = "dlg-review";
  createSession("p-dlg", process.cwd(), { id, command: [FAKE_REVIEW] });
  await waitFor(() => (tmuxCapture(id) ?? "").includes("Ready to submit your answers?"));
  await sendToPane(id, "jawaban lead yang tak relevan di sini");
  await waitFor(() => (tmuxCapture(id) ?? "").includes("Cancel1"));
  expect(tmuxCapture(id) ?? "").not.toContain("jawaban lead yang tak relevan");
  killSession(id);
});

// SPEC-474 · varian preview dijawab lewat kolom catatan: `n` lebih dulu, sebagai keystroke sendiri.
it("membuka kolom catatan dengan `n` saat dialog tak punya kolom jawaban bebas", async () => {
  const id = "dlg-notes";
  createSession("p-dlg", process.cwd(), { id, command: [FAKE_NOTES] });
  await waitFor(() => (tmuxCapture(id) ?? "").includes("press n to add notes"));
  await sendToPane(id, "Pakai map, lebih ekspresif");
  await waitFor(() => (tmuxCapture(id) ?? "").includes("nPakai map, lebih ekspresif"));
  killSession(id);
});
```

- [ ] **Step 3: Jalankan test — pastikan GAGAL**

Run: `pnpm vitest run --no-file-parallelism server/test/pty.test.ts -t "sendToPane"`
Expected: FAIL — pane menerima prosa (bukan `1`) di layar review; `n` tak pernah dikirim di varian preview.

- [ ] **Step 4: Implementasi**

Di `server/src/services/pty.ts`, ganti isi `sendToPane` (bagian `try`) dan tambahkan
`submitPaneDialog` tepat sesudahnya:

```ts
// Primitif pane untuk seluruh interaksi dialog. Satu tempat supaya `sendToPane` dan
// `submitPaneDialog` tak bisa berselisih soal cara mengetik.
const dialogIO = (id: string): PaneIO => ({
  capture: () => capturePane(id, DIALOG_CAPTURE_LINES),
  literal: (s) => { tmux("send-keys", "-t", name(id), "-l", s); },
  enter: () => { tmux("send-keys", "-t", name(id), "Enter"); },
  sleep,
});

export async function sendToPane(id: string, text: string, chunkMs = 50): Promise<boolean> {
  const p = getSession(id);
  if (!p || p.exited) return false;          // AC-10 · pane mati bukan sesi yang menunggu
  const line = text.replace(/\s*\r?\n\s*/g, " ").trim();
  if (!line) return false;
  try {
    const io = dialogIO(id);
    const screen = readDialogScreen(io.capture());
    // SPEC-474 · layar rekap: tak ada yang perlu diketik, cukup ditutup. Prosa di sini ditelan
    // dan `Enter` kebetulan juga men-submit — tapi menekan tombolnya secara eksplisit adalah
    // satu-satunya bentuk yang tak bergantung baris mana yang sedang tersorot.
    if (screen?.kind === "review") return await submitReview(io, screen.submitRow);
    if (screen?.kind === "question") {
      if (screen.freeIndex !== null) return await answerChoiceDialog(io, screen.freeIndex, line, chunkMs);
      // SPEC-474 · varian ber-preview: tak ada kolom bebas, catatan dibuka tombol `n`.
      if (screen.notes) return await answerNotesDialog(io, line, chunkMs);
      // Dialog TANPA kolom bebas & tanpa catatan (trust, prompt izin) sengaja tak disentuh:
      // di sana `Enter` memilih baris 1 yang memang berarti "ya".
    }
    for (const chunk of goalChunks(line)) {
      io.literal(chunk);
      await sleep(chunkMs);
    }
    io.enter();
    return true;
  } catch { return false; }                   // sesi lenyap di tengah pengetikan
}

/**
 * SPEC-474 · tutup dialog berantai yang seluruh pertanyaannya sudah dijawab. Dipakai pintu
 * deteksi lead sebagai langkah MEKANIS — tak ada keputusan yang perlu diambil untuk menekannya,
 * jadi tak ada agen yang dipanggil. `false` bila layarnya bukan layar review.
 */
export async function submitPaneDialog(id: string): Promise<boolean> {
  const p = getSession(id);
  if (!p || p.exited) return false;
  try {
    const io = dialogIO(id);
    const screen = readDialogScreen(io.capture());
    if (screen?.kind !== "review") return false;
    return await submitReview(io, screen.submitRow);
  } catch { return false; }
}
```

Perbarui baris `import` dari `./tui-dialog` di kepala `pty.ts` menjadi:

```ts
import {
  answerChoiceDialog, answerNotesDialog, readChoiceDialog, readDialogScreen, submitReview,
  type PaneIO,
} from "./tui-dialog";
```

(`readChoiceDialog` tetap dipakai bagian lain berkas ini; biarkan.)

- [ ] **Step 5: Jalankan test — pastikan LULUS**

Run: `pnpm vitest run --no-file-parallelism server/test/pty.test.ts -t "sendToPane"`
Expected: PASS — termasuk ketiga test SPEC-452 lama yang tak boleh berubah maknanya.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts server/test/fixtures/fake-review.sh server/test/fixtures/fake-notes-dialog.sh
git commit -m "feat(474): sendToPane merutekan menurut bentuk layar + submitPaneDialog"
```

---

### Task 4: `detect.ts` menggerakkan rantai sampai submit

**Files:**
- Modify: `server/src/services/lead/detect.ts`
- Test: `server/test/lead-detect.test.ts`

**Interfaces:**
- Consumes: `readDialogScreen`, `dialogKey` (Task 1), `submitPaneDialog` (Task 3), `decide`, `takeReply`, `recordDecision`.
- Produces:
  ```ts
  export const MAX_CHAIN_STEPS: number;                    // 6
  // DetectDeps bertambah dua field WAJIB:
  //   submit: (id: string) => Promise<boolean>;
  //   sleep: (ms: number) => Promise<void>;
  ```

- [ ] **Step 1: Tulis test yang gagal**

Di `server/test/lead-detect.test.ts` — tambahkan dua field baru ke helper pembangun deps yang
sudah ada (`submit: async () => true`, `sleep: async () => {}`) lalu tambahkan blok:

```ts
// SPEC-474 · dialog `AskUserQuestion` berantai. Layar berganti setiap kali dijawab; pane
// dimodelkan sebagai ANTREAN layar supaya urutannya persis seperti di TUI sungguhan.
const Q1 = [
  "←  ☐ Warna  ☐ Ukuran  ✔ Submit  →", "", "Pilih warna tema?", "",
  "❯ 1. Merah", "  2. Biru", "  3. Type something.", "  4. Chat about this", "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n");
const Q2 = Q1.replace("☐ Warna", "☒ Warna").replace("Pilih warna tema?", "Pilih ukuran font?")
  .replace("❯ 1. Merah", "❯ 1. Kecil").replace("  2. Biru", "  2. Besar");
const REVIEW = [
  "←  ☒ Warna  ☒ Ukuran  ✔ Submit  →", "", "Review your answers", "",
  "Ready to submit your answers?", "", "❯ 1. Submit answers", "  2. Cancel",
].join("\n");
const SELESAI = "⏺ User answered Claude's questions:\n\n❯ \n  ⏵⏵ bypass permissions on";

describe("scanAndAnswer · rantai dialog sampai submit (SPEC-474)", () => {
  it("menjawab tiap pertanyaan lalu MENEKAN submit, satu keputusan per pertanyaan", async () => {
    const screens = [Q1, Q2, REVIEW, SELESAI];
    let idx = 0;
    const sent: string[] = [];
    let submits = 0, decides = 0, cleared = 0;
    const deps = mkDeps({
      pane: () => screens[Math.min(idx, screens.length - 1)]!,
      send: async (_id, text) => { sent.push(text); idx++; return true; },
      submit: async () => { submits++; idx++; return true; },
      clearMarker: () => { cleared++; },
      decide: (async (input: unknown) => { decides++; return berlaku(`jawab-${decides}`); }) as never,
    });
    const out = await scanAndAnswer(deps);
    expect(out.answered).toEqual(["s1"]);
    expect(decides).toBe(2);                 // dua pertanyaan, dua keputusan
    expect(submits).toBe(1);                 // submit TIDAK memanggil agen
    expect(sent).toEqual(["jawab-1", "jawab-2"]);
    expect(cleared).toBe(1);                 // marker dikosongkan SEKALI, di ujung rantai
    expect(answerCount("s1")).toBe(1);       // satu rantai = SATU jawaban otomatis
  });

  it("rantai putus TIDAK mengosongkan marker dan dihitung sebagai kegagalan", async () => {
    const screens = [Q1, Q2];
    let idx = 0, decides = 0, cleared = 0;
    const deps = mkDeps({
      pane: () => screens[Math.min(idx, screens.length - 1)]!,
      send: async () => { idx++; return true; },
      clearMarker: () => { cleared++; },
      decide: (async () => { decides++; return decides === 1 ? berlaku("ok") : gagal(); }) as never,
    });
    const out = await scanAndAnswer(deps);
    expect(out.answered).toEqual([]);
    expect(cleared).toBe(0);                 // sesi tetap terlihat MENUNGGU oleh operator
    expect(failureCount("s1")).toBe(1);
    expect(answerCount("s1")).toBe(0);
  });

  it("berhenti bila layar dialog tak berubah sesudah dijawab (anti-loop)", async () => {
    let decides = 0, cleared = 0;
    const deps = mkDeps({
      pane: () => Q1,                         // layar MACET: tak pernah maju
      send: async () => true,
      clearMarker: () => { cleared++; },
      decide: (async () => { decides++; return berlaku("ok"); }) as never,
    });
    await scanAndAnswer(deps);
    expect(decides).toBe(1);                  // tak mengulang keputusan untuk layar yang sama
    expect(cleared).toBe(0);
    expect(failureCount("s1")).toBe(1);
  });

  // Jalur lama (kolom chat biasa, dialog satu pertanyaan) tak boleh berubah sedikit pun.
  it("kolom chat biasa tetap satu jawaban lalu selesai", async () => {
    let cleared = 0, decides = 0;
    const deps = mkDeps({
      pane: () => "Mau lanjut ke langkah berikutnya?",
      send: async () => true,
      clearMarker: () => { cleared++; },
      decide: (async () => { decides++; return berlaku("lanjut"); }) as never,
    });
    const out = await scanAndAnswer(deps);
    expect(out.answered).toEqual(["s1"]);
    expect(decides).toBe(1);
    expect(cleared).toBe(1);
    expect(answerCount("s1")).toBe(1);
  });
});
```

(`mkDeps`, `berlaku`, `gagal` adalah helper yang sudah ada / dibuat menyesuaikan gaya berkas test
itu; `berlaku(answer)` mengembalikan baris jejak ber-`status: "berlaku"` dan `answer` tersebut,
`gagal()` mengembalikan baris ber-`status: "gagal"`.)

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `pnpm vitest run --no-file-parallelism server/test/lead-detect.test.ts`
Expected: FAIL — `decides` = 1 (rantai tak pernah maju), `cleared` = 1 pada test rantai putus.

- [ ] **Step 3: Implementasi**

Di `server/src/services/lead/detect.ts`:

1. Tambahkan import:

```ts
import { capturePane, getSession, liveDecisions, markerFilled, sendToPane, submitPaneDialog } from "../pty";
import { dialogKey, readDialogScreen } from "../tui-dialog";
```

2. Tambahkan konstanta di bawah blok penghitung:

```ts
/**
 * SPEC-474 · batas langkah satu rantai dialog. KONSTANTA modul, bukan konfigurasi (cermin
 * `LEAD_ACTIONS`, ADR-0091): kontrak tool `AskUserQuestion` memberi maksimum 4 pertanyaan, dan
 * dua langkah sisanya menampung layar review + satu layar tak terduga. Tanpa batas ini satu pane
 * yang menolak maju bisa membakar giliran agen tanpa ujung (kelas SPEC-472).
 */
export const MAX_CHAIN_STEPS = 6;

/** Jeda & percobaan menunggu layar dialog BERGANTI sesudah dijawab (±6 dtk). */
const CHAIN_POLL_MS = 300;
const CHAIN_POLL_TRIES = 20;
```

3. Tambahkan dua field ke `DetectDeps`:

```ts
  /**
   * SPEC-474 · tekan `Submit answers` pada layar rekap dialog berantai. Langkah MEKANIS: ia tak
   * pernah memanggil agen, karena tak ada yang perlu dipertimbangkan untuk menutup dialog yang
   * seluruh jawabannya sudah masuk.
   */
  submit: (id: string) => Promise<boolean>;
  /** Jeda antar-pembacaan layar; disuntikkan supaya rantai bisa diuji tanpa waktu nyata. */
  sleep: (ms: number) => Promise<void>;
```

dan ke `prodDetectDeps`:

```ts
  submit: (id) => submitPaneDialog(id),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
```

4. Ganti bagian sesudah gerbang `readPaneQuestion` di `scanAndAnswer` (mulai dari
   `const notes = [...]` sampai `out.answered.push(s.id);`) dengan:

```ts
    const chain = await runChain(s, agent, deps);
    if (chain.acted && chain.done) {
      // SPEC-452/474 · marker dikosongkan HANYA sesudah layar bukan dialog lagi. Mengosongkannya
      // di tengah rantai (perilaku sebelum spec ini) membuat sisa rantai tak terlihat oleh siapa
      // pun: hook `Notification` claude terisi SEKALI per dialog dan tak pernah menembak lagi —
      // terukur 0 B selama 120 dtk dengan dialog masih terbuka.
      deps.clearMarker(s.decisionFile);
      answers.set(s.id, (answers.get(s.id) ?? 0) + 1);   // satu RANTAI = satu jawaban otomatis
      failures.delete(s.id);                              // "beruntun" — keberhasilan memutus rantainya
      out.answered.push(s.id);
      continue;
    }
    if (chain.failed) failures.set(s.id, (failures.get(s.id) ?? 0) + 1);
    skip(chain.reason);
  }
  return out;
}

type ChainResult = {
  /** Minimal satu jawaban terkirim atau satu submit berhasil. */
  acted: boolean;
  /** Layar sudah bukan dialog lagi — rantainya benar-benar tuntas. */
  done: boolean;
  /** Kegagalan yang layak dihitung (bukan sekadar lead dijeda di tengah panggilan). */
  failed: boolean;
  reason: string;
};

/**
 * SPEC-474 · satu rantai `AskUserQuestion`: jawab pertanyaan yang tampil, tunggu layarnya
 * berganti, ulangi, dan tutup dengan submit. Semuanya dalam SATU putaran deteksi — menunggu
 * denyut berikutnya bukan pilihan, karena marker keputusan tak pernah terisi untuk kedua kalinya.
 */
async function runChain(
  s: { id: string; specId?: string; projectId: string },
  agent: Agent,
  deps: DetectDeps,
): Promise<ChainResult> {
  let acted = false;
  for (let step = 0; step < MAX_CHAIN_STEPS; step++) {
    const text = deps.pane(s.id);
    const screen = readDialogScreen(text);

    if (screen?.kind === "review") {
      if (!(await deps.submit(s.id)))
        return { acted, done: false, failed: true, reason: "gagal menekan Submit answers" };
      acted = true;
      continue;
    }
    // Layar sudah bukan dialog: rantai tuntas. (Langkah 0 sengaja dikecualikan — di sana layar
    // memang boleh berupa kolom chat biasa, dan itu jalur lama yang harus tetap dilayani.)
    if (step > 0 && !screen) return { acted, done: true, failed: false, reason: "" };

    const read = readPaneQuestion(text, agent);
    if (!read.asking) {
      return step === 0
        ? { acted, done: false, failed: false, reason: read.reason }
        : { acted, done: true, failed: false, reason: "" };
    }

    const notes = [`Sesi ini menunggu di terminal; teks di bawah adalah layar terakhirnya. Jawablah sebagai masukan yang bisa langsung diketik ke terminal itu (isi \`reply\`).`];
    if (read.choices.length) {
      notes.push("Layarnya adalah dialog pilihan. `reply` akan dimasukkan sebagai JAWABAN BEBAS ke dialog itu, jadi tulislah jawaban yang berdiri sendiri — sebut opsi yang kamu pilih beserta alasan singkatnya, bukan nomornya saja.");
    }
    if (screen?.kind === "question" && screen.tabs.length > 1) {
      const at = screen.tabs.findIndex((t) => !t.answered);
      notes.push(`Dialog ini BERANTAI: ${screen.tabs.length} pertanyaan dalam satu tanya (${screen.tabs.map((t) => `${t.answered ? "sudah" : "belum"}: ${t.header}`).join(", ")}). Yang sedang tampil pertanyaan ke-${at + 1}; jawab HANYA pertanyaan itu — sisanya akan ditanyakan sesudah ini.`);
    }

    const row = await deps.decide({
      projectId: s.projectId, specId: s.specId, sessionId: s.id,
      gate: "detected", kind: "answer",
      question: read.question,
      options: read.choices.length ? read.choices : undefined,
      notes,
    }, deps.decideDeps);
    // `null` = lead baru saja dijeda/dimatikan di tengah panggilan — bukan kegagalan lead.
    if (!row) return { acted, done: false, failed: false, reason: "lead tak menghasilkan keputusan yang berlaku" };
    if (row.status !== "berlaku")
      return { acted, done: false, failed: true, reason: "lead tak menghasilkan keputusan yang berlaku" };

    const reply = takeReply(row.id) || row.answer;
    if (!(await deps.send(s.id, reply)))
      return { acted, done: false, failed: true, reason: "gagal mengetik ke pane" };
    acted = true;

    // Kolom chat biasa: satu jawaban lalu selesai — perilaku persis sebelum spec ini.
    if (!screen) return { acted, done: true, failed: false, reason: "" };

    // Dialog: tunggu layarnya BENAR-BENAR berganti sebelum mata rantai berikutnya dibaca. Tanpa
    // jeda ini tangkapan berikutnya masih layar yang sama dan gerbang anti-loop akan menutup
    // rantai yang sebenarnya sehat.
    if (!(await waitScreenChange(s.id, dialogKey(text), deps)))
      return { acted, done: false, failed: true, reason: "layar dialog tak berubah sesudah dijawab" };
  }
  return { acted, done: false, failed: true, reason: "batas langkah rantai dialog tercapai" };
}

async function waitScreenChange(id: string, before: string, deps: DetectDeps): Promise<boolean> {
  for (let i = 0; i < CHAIN_POLL_TRIES; i++) {
    await deps.sleep(CHAIN_POLL_MS);
    if (dialogKey(deps.pane(id)) !== before) return true;
  }
  return false;
}
```

5. Pastikan `sweep` tetap berada di akhir berkas dan `import type { Agent, Lead }` masih dipakai.

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `pnpm vitest run --no-file-parallelism server/test/lead-detect.test.ts`
Expected: PASS — termasuk seluruh test SPEC-409/452/472 lama.

- [ ] **Step 5: Typecheck paket server**

Run: `pnpm --filter ./server typecheck`
Expected: keluar tanpa error.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/lead/detect.ts server/test/lead-detect.test.ts
git commit -m "feat(474): pintu deteksi menuntaskan rantai dialog sampai submit"
```

---

### Task 5: Docs Source of Truth + verifikasi akhir

**Files:**
- Modify: `internal/skills/hanoman/SKILL.md`
- Modify: `docs/superpowers/plans/2026-08-01-keputusan-lead-berantai-spec-474.md` (centang kotak)

- [ ] **Step 1: Tulis butir permanen di SKILL.md**

Tambahkan satu butir sesudah butir SPEC-472 (“Lead yang gagal WAJIB mengatakan kenapa…”), memuat
sekurang-kurangnya: bentuk rantai (tab strip + auto-advance), layar review tanpa footer, marker
yang terisi **sekali**, satu rantai = satu jawaban otomatis, submit tanpa agen, varian preview
(catatan lewat `n`), dan `MAX_CHAIN_STEPS` sebagai konstanta.

- [ ] **Step 2: Jalankan seluruh test yang tersentuh**

Run: `pnpm vitest run --no-file-parallelism server/test/tui-dialog.test.ts server/test/pty.test.ts server/test/lead-detect.test.ts server/test/lead-pane.test.ts`
Expected: PASS semuanya. **Pastikan jumlah test yang berjalan > 0** — `--changed` menyalakan
`passWithNoTests`, jadi “no test files” terlihat hijau padahal tak menguji apa pun.

- [ ] **Step 3: Typecheck paket server**

Run: `pnpm --filter ./server typecheck`
Expected: bersih.

- [ ] **Step 4: Commit + push**

```bash
git add internal/skills/hanoman/SKILL.md docs/superpowers/plans/2026-08-01-keputusan-lead-berantai-spec-474.md
git commit -m "docs(474): butir permanen rantai dialog di SKILL.md + plan terceklist"
git push origin HEAD:refs/heads/hanoman/spec-474
```

---

## Self-Review

**Spec coverage:**

| Spec | Task |
|---|---|
| AC-1 rantai dijawab berurutan, satu keputusan per pertanyaan | Task 4 |
| AC-2 submit lewat keystroke satu karakter, tanpa agen | Task 2 (`submitReview`) + Task 4 (`deps.submit`) |
| AC-3 `Enter` hanya sesudah teks mendarat | Task 2 (`notesFilled`) + `answerChoiceDialog` lama (tak diubah) |
| AC-4 marker dikosongkan hanya di ujung rantai | Task 4 |
| AC-5 rantai putus → marker tetap, `failures` naik | Task 4 |
| AC-6 `MAX_CHAIN_STEPS` | Task 4 |
| AC-7 satu rantai = satu jawaban otomatis | Task 4 |
| AC-8 varian preview lewat kolom catatan | Task 1 (`notes`) + Task 2 (`answerNotesDialog`) + Task 3 (routing) |
| AC-9 anti-loop lewat `dialogKey` | Task 1 + Task 4 |
| AC-10 dialog trust & kolom chat tak berubah | Task 1 (test), Task 3 (jalur lama), Task 4 (test) |
| AC-11 dialog satu pertanyaan tetap seperti dulu | Task 1 (test), Task 4 (test) |

**Placeholder scan:** tak ada `TBD`/`TODO`; tiap langkah kode memuat kodenya.

**Type consistency:** `DialogScreen`/`DialogTab` dipakai identik di Task 1/3/4; `readDialogScreen`,
`dialogKey`, `readReviewScreen`, `notesFilled`, `answerNotesDialog`, `submitReview`,
`submitPaneDialog`, `MAX_CHAIN_STEPS` bernama sama di seluruh plan.
