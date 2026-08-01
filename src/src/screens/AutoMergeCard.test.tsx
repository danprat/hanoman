import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoMergeCard } from "./AutoMergeCard";
import type { ProjectVM } from "./types";

const base = {
  id: "hanoman", name: "hanoman", desc: "", kind: "existing", repoDir: "/repo", binding: null,
  gitRemote: null, stack: "", docStatus: "ok", coverage: 100, createdAt: "2026-08-01T00:00:00.000Z",
  backlog: 0, topStage: "spec", session: { status: "idle", phase: null, flow: null },
  activity: "idle", commit: "—", helpEnabled: false, schedulerOptIn: false, leadOptIn: false,
  autoMerge: null,
} as unknown as ProjectVM;

const json = (v: unknown, statusCode = 200) =>
  Promise.resolve({ ok: statusCode < 400, status: statusCode, json: async () => v } as Response);

function mockFetch(patch: (b: unknown) => Promise<Response> = () => json({ ...base })) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes("/branches")) return json({ branches: ["main", "develop"], remotes: ["main"], defaultBranch: "main" });
    if (init?.method === "PATCH") return patch(JSON.parse(String(init.body)));
    return json({});
  });
}
afterEach(() => vi.restoreAllMocks());

describe("AutoMergeCard", () => {
  it("default: tanpa auto-merge", async () => {
    mockFetch();
    render(<AutoMergeCard p={base} onToast={() => { }} />);
    // Cocok PERSIS pada badge ringkasan: label opsi "Tanpa auto-merge (default)" di dalam
    // <select> juga memuat frasa itu, dan regex longgar akan cocok ganda (kelas SPEC-385).
    expect(await screen.findByText("tanpa auto-merge")).toBeTruthy();
  });

  it("tanpa repoDir efektif kontrolnya mati dan alasannya tertulis", async () => {
    mockFetch();
    render(<AutoMergeCard p={{ ...base, repoDir: null, binding: null }} onToast={() => { }} />);
    expect(await screen.findByText(/belum di-bind ke checkout lokal/i)).toBeTruthy();
    expect((screen.getByLabelText("Mode auto-merge") as HTMLSelectElement).disabled).toBe(true);
  });

  it("menyimpan mode default-branch dengan dest pilihan operator", async () => {
    const sent: unknown[] = [];
    mockFetch((b) => { sent.push(b); return json({ ...base, autoMerge: b }); });
    render(<AutoMergeCard p={base} onToast={() => { }} />);
    fireEvent.change(await screen.findByLabelText("Mode auto-merge"), { target: { value: "default-branch" } });
    fireEvent.change(screen.getByLabelText("Tujuan"), { target: { value: "origin" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ autoMerge: { mode: "default-branch", dest: "origin", branch: null, deleteBranch: false } });
  });

  it("mode branch memakai daftar branch repo dan mengirim branch terpilih", async () => {
    const sent: unknown[] = [];
    mockFetch((b) => { sent.push(b); return json({ ...base, autoMerge: b }); });
    render(<AutoMergeCard p={base} onToast={() => { }} />);
    fireEvent.change(await screen.findByLabelText("Mode auto-merge"), { target: { value: "branch" } });
    fireEvent.change(await screen.findByLabelText("Branch tujuan"), { target: { value: "develop" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ autoMerge: { mode: "branch", dest: "local", branch: "develop", deleteBranch: false } });
  });

  it("galat server ditampilkan apa adanya lewat toast", async () => {
    const toasts: string[] = [];
    mockFetch(() => json({ error: "project belum di-bind ke checkout lokal" }, 409));
    render(<AutoMergeCard p={base} onToast={(m) => toasts.push(m)} />);
    fireEvent.change(await screen.findByLabelText("Mode auto-merge"), { target: { value: "default-branch" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(toasts.join(" ")).toMatch(/gagal/i));
  });
});
