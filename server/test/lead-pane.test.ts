import { describe, it, expect } from "vitest";
import { readPaneQuestion } from "../src/services/lead/pane";

// SPEC-409 · ADR-0091 · AC-9 · membedakan "sesi bertanya" dari "sesi codex selesai wajar".
// Ini pintu yang MENGETIK ke terminal agen yang sedang bekerja, jadi bias-nya harus ke diam.

const CLAUDE_ASKING = `
╭──────────────────────────────────────╮
│ Saya menemukan dua jalan:            │
│ 1) pakai kolom baru di Spec          │
│ 2) turunkan dari updatedAt           │
│ Mana yang kamu mau?                  │
╰──────────────────────────────────────╯
`;

describe("readPaneQuestion · claude", () => {
  it("trusts the marker: hook Notification hanya menembak saat agen minta masukan", () => {
    const r = readPaneQuestion(CLAUDE_ASKING, "claude");
    expect(r.asking).toBe(true);
    expect(r.question).toContain("Mana yang kamu mau?");
  });
  it("strips TUI box drawing so the question reads as prose", () => {
    expect(readPaneQuestion(CLAUDE_ASKING, "claude").question).not.toMatch(/[│╭╰]/);
  });
  it("says no when the screen is blank", () => {
    expect(readPaneQuestion("   \n\n  ", "claude").asking).toBe(false);
  });
});

describe("readPaneQuestion · codex (AC-9)", () => {
  // ADR-0074: marker codex diturunkan dari Stop+UserPromptSubmit, jadi ia menyala JUGA saat sesi
  // selesai wajar. Mengetik ke sana berarti membangunkan sesi yang sudah selesai dan memulai
  // pekerjaan yang tak diminta siapa pun.
  it("refuses to answer a codex session that finished normally", () => {
    const r = readPaneQuestion("Goal achieved\n• Ran 12 tests, all green\n245k tokens used", "codex");
    expect(r.asking).toBe(false);
    expect(r.reason).toContain("selesai wajar");
  });
  it("refuses when the goal was declared unmet — itu laporan, bukan pertanyaan", () => {
    expect(readPaneQuestion("Goal unmet: tests still failing", "codex").asking).toBe(false);
  });
  it("answers when codex really asks something", () => {
    const r = readPaneQuestion("Saya butuh keputusan.\nApakah kolom baru boleh ditambahkan?", "codex");
    expect(r.asking).toBe(true);
  });
  it("answers when codex offers a numbered list of options", () => {
    expect(readPaneQuestion("Pilihan:\n1) tambah kolom\n2) turunkan saja", "codex").asking).toBe(true);
  });
  it("stays silent on codex output that is neither a question nor a known finish marker", () => {
    const r = readPaneQuestion("Menulis services/date-range.ts\nMenjalankan vitest", "codex");
    expect(r.asking).toBe(false);
    expect(r.reason).toContain("tak ada sinyal pertanyaan");
  });
  // Jebakan yang paling mudah tertulis: menganggap "ada tanda tanya di mana pun" = bertanya,
  // padahal ringkasan selesai codex bisa memuatnya. Penanda selesai harus MENANG.
  it("lets the finish marker win over a stray question mark", () => {
    expect(readPaneQuestion("Selesai. Mau saya lanjut?\nGoal achieved", "codex").asking).toBe(false);
  });
});

// SPEC-452 · dialog `AskUserQuestion`: opsinya harus SAMPAI ke lead sebagai daftar, bukan hanya
// terkubur di dalam teks layar. `leadPrompt` sudah punya tempatnya (`options`) sejak ADR-0091;
// yang tak pernah ada adalah yang mengisinya dari pintu deteksi.
const ASKQ = `
Mau pakai strategi cache yang mana?

❯ 1. In-memory
     Cache disimpan di memori proses
  2. Redis
  3. Tanpa cache
  4. Type something.
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`;

describe("readPaneQuestion · opsi dialog (SPEC-452)", () => {
  it("menyodorkan opsi dialog claude sebagai daftar", () => {
    const r = readPaneQuestion(ASKQ, "claude");
    expect(r.asking).toBe(true);
    expect(r.choices).toEqual(["In-memory", "Redis", "Tanpa cache"]);
  });

  it("tak mengarang opsi untuk layar yang bukan dialog", () => {
    expect(readPaneQuestion(CLAUDE_ASKING, "claude").choices).toEqual([]);
  });

  it("dialog yang sama juga terbaca saat agennya codex", () => {
    expect(readPaneQuestion(ASKQ, "codex").choices).toEqual(["In-memory", "Redis", "Tanpa cache"]);
  });
});
