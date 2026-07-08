import { describe, it, expect } from "vitest";
import { deniesDangerous } from "../src/safety";
describe("safety", () => {
  it("denies rm -rf", () => expect(deniesDangerous("Bash", { command: "rm -rf /" })).toBe(true));
  it("denies push to main", () => expect(deniesDangerous("Bash", { command: "git push origin main" })).toBe(true));
  it("allows an ordinary edit", () => expect(deniesDangerous("Edit", { file_path: "src/a.ts" })).toBe(false));
});
