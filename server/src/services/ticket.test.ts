import { describe, it, expect } from "vitest";
import { generateAccessKey, hashAccessKey, publicStatus } from "./ticket";

describe("ticket access key", () => {
  it("generate key berprefix + hash konsisten", () => {
    const { key, hash } = generateAccessKey();
    expect(key.startsWith("hnm_tkt_")).toBe(true);
    expect(hashAccessKey(key)).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("dua key berbeda", () => {
    expect(generateAccessKey().key).not.toBe(generateAccessKey().key);
  });
});

describe("publicStatus (derived, tanpa jargon internal)", () => {
  it("new → Sedang ditinjau", () => expect(publicStatus("new")).toBe("Sedang ditinjau"));
  it("rejected → Ditutup", () => expect(publicStatus("rejected")).toBe("Ditutup"));
  it("accepted tanpa spec → Diterima", () => expect(publicStatus("accepted", null)).toBe("Diterima"));
  it("accepted + planned → Diterima", () => expect(publicStatus("accepted", "planned")).toBe("Diterima"));
  it("accepted + brainstorming → Diterima", () => expect(publicStatus("accepted", "brainstorming")).toBe("Diterima"));
  it("accepted + executing → Sedang dikerjakan", () => expect(publicStatus("accepted", "executing")).toBe("Sedang dikerjakan"));
  it("accepted + done → Selesai", () => expect(publicStatus("accepted", "done")).toBe("Selesai"));
});
