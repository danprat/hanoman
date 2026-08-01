import { describe, it, expect } from "vitest";
import {
  zAutoMerge, autoMergeOf, resolveAutoMerge, autoMergeTargetOf, autoMergeSummary, AUTO_MERGE_OFF,
} from "./auto-merge";

describe("zAutoMerge", () => {
  it("mengisi default untuk kunci yang hilang", () => {
    expect(zAutoMerge.parse({})).toEqual({ mode: "off", dest: "local", branch: null, deleteBranch: false });
  });
  it("menolak mode karangan", () => {
    expect(zAutoMerge.safeParse({ mode: "squash" }).success).toBe(false);
  });
});

describe("autoMergeOf — kolom Json dibaca defensif", () => {
  it("null/undefined → null (tak ada kebijakan)", () => {
    expect(autoMergeOf(null)).toBeNull();
    expect(autoMergeOf(undefined)).toBeNull();
  });
  it("bentuk rusak → null, bukan melempar", () => {
    expect(autoMergeOf({ mode: 7 })).toBeNull();
    expect(autoMergeOf("main")).toBeNull();
  });
  it("bentuk sah dikembalikan lengkap dengan default", () => {
    expect(autoMergeOf({ mode: "branch", branch: "develop" }))
      .toEqual({ mode: "branch", dest: "local", branch: "develop", deleteBranch: false });
  });
});

describe("resolveAutoMerge — spec menang, lalu project, lalu OFF", () => {
  const proj = { mode: "default-branch", dest: "origin", branch: null, deleteBranch: false };
  it("spec null → warisi project", () => {
    expect(resolveAutoMerge(proj, null)).toEqual(proj);
  });
  it("spec terisi → menang atas project", () => {
    expect(resolveAutoMerge(proj, { mode: "branch", dest: "local", branch: "rilis" }))
      .toEqual({ mode: "branch", dest: "local", branch: "rilis", deleteBranch: false });
  });
  it("spec bisa MEMATIKAN auto-merge di satu item saja", () => {
    expect(resolveAutoMerge(proj, { mode: "off" }).mode).toBe("off");
  });
  it("keduanya kosong → OFF", () => {
    expect(resolveAutoMerge(null, null)).toEqual(AUTO_MERGE_OFF);
  });
  it("project rusak diperlakukan seperti tak ada kebijakan", () => {
    expect(resolveAutoMerge({ mode: "squash" }, null)).toEqual(AUTO_MERGE_OFF);
  });
});

describe("autoMergeTargetOf — kosakata target sama dengan POST /specs/:id/integrate", () => {
  it("mode off → null (tak ada yang dieksekusi)", () => {
    expect(autoMergeTargetOf(AUTO_MERGE_OFF, "main")).toBeNull();
  });
  it("mode branch memakai branch pilihan operator + dest-nya", () => {
    expect(autoMergeTargetOf({ mode: "branch", dest: "origin", branch: "develop", deleteBranch: false }, "main"))
      .toBe("origin:develop");
  });
  it("mode default-branch memakai default branch yang diresolve saat eksekusi", () => {
    expect(autoMergeTargetOf({ mode: "default-branch", dest: "local", branch: null, deleteBranch: false }, "master"))
      .toBe("local:master");
  });
  it("default branch tak terbaca → null, bukan menebak main", () => {
    expect(autoMergeTargetOf({ mode: "default-branch", dest: "local", branch: null, deleteBranch: false }, null))
      .toBeNull();
  });
  it("mode branch tanpa branch → null", () => {
    expect(autoMergeTargetOf({ mode: "branch", dest: "local", branch: null, deleteBranch: false }, "main"))
      .toBeNull();
  });
});

describe("autoMergeSummary", () => {
  it("menyebut tujuan yang bisa dibaca manusia", () => {
    expect(autoMergeSummary(AUTO_MERGE_OFF)).toBe("tanpa auto-merge");
    expect(autoMergeSummary({ mode: "default-branch", dest: "origin", branch: null, deleteBranch: false }))
      .toBe("auto-merge ke default branch repo (origin)");
    expect(autoMergeSummary({ mode: "branch", dest: "local", branch: "develop", deleteBranch: true }))
      .toBe("auto-merge ke develop (lokal) · hapus branch kerja");
  });
});
