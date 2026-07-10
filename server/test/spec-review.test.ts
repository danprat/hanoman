import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { specReview, reviewFile, specCommitRange, specReviewRange, reviewFileRange } from "../src/services/spec-review";
import { makeRepoWithWorktree, makeRepoWithSpecCommits } from "./factory";

const SID = "SPEC-900";
// Real NUL byte → git mendeteksinya sebagai berkas biner (numstat `-`/`-`).
const BIN = "a" + String.fromCharCode(0) + "b";
function repo() {
  return makeRepoWithWorktree(SID,
    { "keep.txt": "satu\n", "gone.txt": "buang\n" },
    { "keep.txt": "satu\ndua\n", "gone.txt": null, "new file.md": "baru\n", "b.bin": BIN });
}

describe("specReview", () => {
  it("all files = tracked ∪ untracked-tak-ignored, sorted", async () => {
    const r = await specReview(repo(), SID, null);
    expect(r.files).toEqual(["b.bin", "keep.txt", "new file.md"]); // gone.txt terhapus
  });
  it("changed: modified +1/-0, deleted D, added A, biner, path berspasi utuh", async () => {
    const r = await specReview(repo(), SID, null);
    const by = Object.fromEntries(r.changed.map((c) => [c.path, c]));
    expect(by["keep.txt"]).toMatchObject({ status: "M", add: 1, del: 0, binary: false });
    expect(by["gone.txt"]).toMatchObject({ status: "D" });
    expect(by["new file.md"]).toMatchObject({ status: "A", binary: false });
    expect(by["b.bin"]).toMatchObject({ status: "A", binary: true });
  });
  it("index repo tak tercemar (status --porcelain identik)", async () => {
    const dir = repo();
    const wt = `${dir}/.worktrees/spec-900`;
    const before = execFileSync("git", ["status", "--porcelain"], { cwd: wt, encoding: "utf8" });
    await specReview(dir, SID, null);
    const after = execFileSync("git", ["status", "--porcelain"], { cwd: wt, encoding: "utf8" });
    expect(after).toBe(before);
  });
});

describe("reviewFile", () => {
  it("file di luar daftar → null (gerbang path)", async () => {
    expect(await reviewFile(repo(), SID, null, "../../etc/passwd")).toBeNull();
  });
  it("file changed: diff + content dari disk", async () => {
    const rf = await reviewFile(repo(), SID, null, "keep.txt");
    expect(rf!.status).toBe("M");
    expect(rf!.diff).toContain("+dua");
    expect(rf!.content).toBe("satu\ndua\n");
  });
  it("file dihapus → content null", async () => {
    const rf = await reviewFile(repo(), SID, null, "gone.txt");
    expect(rf!.status).toBe("D");
    expect(rf!.content).toBeNull();
  });
  it("file biner → binary true, tanpa diff/content", async () => {
    const rf = await reviewFile(repo(), SID, null, "b.bin");
    expect(rf).toMatchObject({ binary: true, diff: null, content: null });
  });
  it("file tak berubah tapi ada di project → content, diff kosong", async () => {
    const dir = makeRepoWithWorktree(SID, { "stay.txt": "tetap\n" }, {});
    const rf = await reviewFile(dir, SID, null, "stay.txt");
    expect(rf!.status).toBeNull();
    expect(rf!.diff).toBe("");
    expect(rf!.content).toBe("tetap\n");
  });
});

// Item selesai: worktree lenyap → review jatuh ke range commit `oldest(spec-N)^..newest`.
describe("review done spec (dari commit history)", () => {
  const HID = "SPEC-901";
  const hrepo = () => makeRepoWithSpecCommits(
    { "keep.txt": "satu\n", "gone.txt": "buang\n", "unrelated.txt": "x\n" },
    [
      { msg: "feat(spec-901): ubah keep, hapus gone", changes: { "keep.txt": "satu\ndua\n", "gone.txt": null } },
      { msg: "feat(spec-901): tambah baru", changes: { "new.md": "baru\n" } },
    ]);

  it("specCommitRange: ada dari pesan commit; spec tanpa commit → null", async () => {
    const dir = hrepo();
    expect(await specCommitRange(dir, HID)).not.toBeNull();
    expect(await specCommitRange(dir, "SPEC-999")).toBeNull();
  });
  it("specReviewRange: changed sepanjang range, file base tak tersentuh hanya di tree", async () => {
    const dir = hrepo();
    const r = (await specCommitRange(dir, HID))!;
    const rev = await specReviewRange(dir, r.base, r.head);
    expect(Object.fromEntries(rev.changed.map((c) => [c.path, c.status])))
      .toEqual({ "keep.txt": "M", "gone.txt": "D", "new.md": "A" });
    expect(rev.files).toContain("unrelated.txt"); // di pohon, tak di changed
  });
  it("reviewFileRange: diff+content dari commit; dihapus → content null; luar daftar → null", async () => {
    const dir = hrepo();
    const r = (await specCommitRange(dir, HID))!;
    const keep = await reviewFileRange(dir, r.base, r.head, "keep.txt");
    expect(keep!.status).toBe("M");
    expect(keep!.diff).toContain("+dua");
    expect(keep!.content).toBe("satu\ndua\n");
    const gone = await reviewFileRange(dir, r.base, r.head, "gone.txt");
    expect(gone).toMatchObject({ status: "D", content: null });
    expect(await reviewFileRange(dir, r.base, r.head, "nope.xyz")).toBeNull();
  });
});
