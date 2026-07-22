import { describe, it, expect } from "vitest";
import { publicStatus } from "./ticket-status";

describe("publicStatus", () => {
  it("rejected → Ditutup", () => expect(publicStatus("rejected")).toBe("Ditutup"));
  it("new → Sedang ditinjau", () => expect(publicStatus("new")).toBe("Sedang ditinjau"));
  it("accepted + done → Selesai", () => expect(publicStatus("accepted", "done")).toBe("Selesai"));
  it("accepted + executing → Sedang dikerjakan", () =>
    expect(publicStatus("accepted", "executing")).toBe("Sedang dikerjakan"));
  it("accepted + brainstorming → Diterima", () =>
    expect(publicStatus("accepted", "brainstorming")).toBe("Diterima"));
  it("accepted + null stage → Diterima", () => expect(publicStatus("accepted", null)).toBe("Diterima"));
});
