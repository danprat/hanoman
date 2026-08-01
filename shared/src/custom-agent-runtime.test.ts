import { describe, it, expect } from "vitest";
import { zCreateCustomAgent, zUpdateCustomAgent, runtimeOf } from "./index";

const base = { name: "rev", description: "d", instructions: "i" };

describe("zCreateCustomAgent · runtime", () => {
  it("menerima claude & codex", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: "claude" }).success).toBe(true);
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: "codex" }).success).toBe(true);
  });
  it("menerima null (= ikut sesi induk) dan absen", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: null }).success).toBe(true);
    expect(zCreateCustomAgent.safeParse(base).success).toBe(true);
  });
  it("MENOLAK nilai di luar AGENT_RUNTIMES", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: "gemini" }).success).toBe(false);
  });
});

describe("zUpdateCustomAgent · runtime", () => {
  it("ikut terbawa sebagai field opsional", () => {
    expect(zUpdateCustomAgent.safeParse({ runtime: "codex" }).success).toBe(true);
    expect(zUpdateCustomAgent.safeParse({ runtime: "gemini" }).success).toBe(false);
  });
});

// Kolom ini menyeberang sync dari client versi lain — nilai asing tak boleh MENYARING HABIS
// seluruh roster, jadi ia dibaca defensif seperti kolom Json lain (ADR-0101 keputusan 1).
describe("runtimeOf", () => {
  it("mengembalikan nilai sah apa adanya", () => {
    expect(runtimeOf("claude")).toBe("claude");
    expect(runtimeOf("codex")).toBe("codex");
  });
  it("nilai asing / kosong → null (warisi), bukan dibuang", () => {
    expect(runtimeOf("gemini")).toBeNull();
    expect(runtimeOf(null)).toBeNull();
    expect(runtimeOf(undefined)).toBeNull();
    expect(runtimeOf(7)).toBeNull();
  });
});
