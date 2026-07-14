import { describe, it, expect } from "vitest";
import { updateHeadline, updateBadgeLabel } from "../src/api/update";
import type { UpdateStatus } from "@hanoman/shared";

const mk = (o: Partial<UpdateStatus>): UpdateStatus => ({
  currentSha: "a", checkoutSha: "a", branch: "main", local: { stale: false },
  remote: { status: "ok", behind: 0, fetchedAt: null }, updateAvailable: false,
  reason: null, command: "", newCommits: [], ...o,
});

describe("updateHeadline", () => {
  it("up-to-date", () => expect(updateHeadline(mk({}))).toMatch(/terbaru/));
  it("local", () => expect(updateHeadline(mk({ updateAvailable: true, reason: "local", local: { stale: true } }))).toMatch(/rebuild/i));
  it("remote menyebut jumlah commit", () =>
    expect(updateHeadline(mk({ updateAvailable: true, reason: "remote", remote: { status: "ok", behind: 4, fetchedAt: null } }))).toMatch(/4 commit/));
  it("both", () =>
    expect(updateHeadline(mk({ updateAvailable: true, reason: "both", local: { stale: true }, remote: { status: "ok", behind: 2, fetchedAt: null } }))).toMatch(/\+ 2/));
});
describe("updateBadgeLabel", () => {
  it("tanpa remote behind → 'Update'", () => expect(updateBadgeLabel(mk({ updateAvailable: true, reason: "local" }))).toBe("Update"));
  it("dengan remote behind → 'Update · N'", () =>
    expect(updateBadgeLabel(mk({ updateAvailable: true, reason: "remote", remote: { status: "ok", behind: 3, fetchedAt: null } }))).toBe("Update · 3"));
});
