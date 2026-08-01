import { describe, it, expect } from "vitest";
import { doctorReport } from "../src/commands/doctor";

const ok = {
  node: "v22.0.0", git: "git version 2.44.0", tmux: "tmux 3.4",
  claude: "1.0.0", codex: null, gh: null, homeWritable: true, web: true, db: "/h/.hanoman/hanoman.db",
};

describe("doctorReport", () => {
  it("semua ada → ok", () => {
    const r = doctorReport(ok);
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("git");
  });
  it("git absen → tidak ok", () => {
    expect(doctorReport({ ...ok, git: null }).ok).toBe(false);
  });
  it("tmux absen → tidak ok (sesi mustahil tanpa tmux)", () => {
    expect(doctorReport({ ...ok, tmux: null }).ok).toBe(false);
  });
  it("node di bawah 20 → tidak ok", () => {
    expect(doctorReport({ ...ok, node: "v18.20.0" }).ok).toBe(false);
  });
  it("kedua agen absen → tidak ok", () => {
    expect(doctorReport({ ...ok, claude: null, codex: null }).ok).toBe(false);
  });
  it("satu agen cukup", () => {
    expect(doctorReport({ ...ok, claude: null, codex: "0.146.0" }).ok).toBe(true);
  });
  it("data dir tak bisa ditulis → tidak ok", () => {
    expect(doctorReport({ ...ok, homeWritable: false }).ok).toBe(false);
  });
  it("aset web absen → peringatan, tetap ok (API tetap jalan)", () => {
    const r = doctorReport({ ...ok, web: false });
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("dashboard");
  });
  it("path db selalu dilaporkan", () => {
    expect(doctorReport(ok).lines.join("\n")).toContain("/h/.hanoman/hanoman.db");
  });
  // SPEC-471 · `gh` opsional (cermin claude/codex): absen TIDAK boleh menggagalkan doctor —
  // jalur REST + GITHUB_TOKEN tetap bekerja tanpa biner itu.
  it("SPEC-471 · gh absen = baris informatif, BUKAN fatal", () => {
    const tanpa = doctorReport({ ...ok, gh: null });
    expect(tanpa.ok).toBe(true);
    expect(tanpa.lines.join("\n")).toContain("GITHUB_TOKEN");
    const dengan = doctorReport({ ...ok, gh: "gh version 2.96.0" });
    expect(dengan.ok).toBe(true);
    expect(dengan.lines.join("\n")).toContain("gh version 2.96.0");
  });
});
