import { afterEach, describe, expect, it } from "vitest";
import { buildTelegramOperatorPrompt } from "./telegram-operator";

const input = {
  update: { updateId: 17, chatId: "42", kind: "text" as const, text: "Apa status SPEC-476?" },
  personality: {
    name: "operator-ringkas",
    description: "Operator Hanoman yang lugas",
    instructions: "Jawab singkat dan selalu periksa Source of Truth.",
  },
  summary: "Operator sedang mengerjakan SPEC-476.",
  memories: [{ id: "mem-1", content: "Pilih jawaban ringkas." }],
};

describe("buildTelegramOperatorPrompt (SPEC-476)", () => {
  afterEach(() => { delete process.env.HANOMAN_TELEGRAM_AGENT_TOKEN; });

  it("embeds the first update, personality, summary, and curated memory", () => {
    const prompt = buildTelegramOperatorPrompt(input);
    expect(prompt).toContain("[Telegram update 17 · chat 42 · kind text]");
    expect(prompt).toContain("Apa status SPEC-476?");
    expect(prompt).toContain("@operator-ringkas");
    expect(prompt).toContain("Jawab singkat dan selalu periksa Source of Truth.");
    expect(prompt).toContain("Operator sedang mengerjakan SPEC-476.");
    expect(prompt).toContain("mem-1: Pilih jawaban ringkas.");
  });

  it("references credential variable names but never reads or embeds their values", () => {
    process.env.HANOMAN_TELEGRAM_AGENT_TOKEN = "hnm_agent_SUPER_SECRET";
    const prompt = buildTelegramOperatorPrompt(input);
    expect(prompt).toContain("$HANOMAN_TELEGRAM_AGENT_TOKEN");
    expect(prompt).toContain("$HANOMAN_API_BASE");
    expect(prompt).not.toContain("hnm_agent_SUPER_SECRET");
  });

  it("keeps natural language primary while documenting the complete command surface", () => {
    const prompt = buildTelegramOperatorPrompt(input);
    for (const command of [
      "/help", "/status", "/projects", "/project", "/backlog", "/sessions",
      "/use", "/new", "/stop", "/memory", "/personality", "/skills",
    ]) expect(prompt).toContain(command);
    expect(prompt).toContain("Bahasa natural adalah antarmuka utama");
  });

  it("requires product APIs, correlation, explicit replies, and secret-safe output", () => {
    const prompt = buildTelegramOperatorPrompt(input);
    expect(prompt).toContain("x-hanoman-telegram-update: 17");
    expect(prompt).toContain("POST $HANOMAN_API_BASE/api/telegram/replies");
    expect(prompt).toContain("progress|final|decision|failure|confirmation");
    expect(prompt).toContain("Jangan pernah kirim internal reasoning");
    expect(prompt).toContain("confirmation");
    expect(prompt).not.toContain("capturePane");
  });
});
