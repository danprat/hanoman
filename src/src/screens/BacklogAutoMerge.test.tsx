import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BacklogScreen } from "./BacklogScreen";
import type { Spec } from "@hanoman/shared";

const spec = {
  id: "SPEC-1", projectId: "hanoman", title: "Fitur", source: "brief", stage: "executing",
  priority: "sedang", author: "a", objective: "obj",
  payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" },
  branchFrom: null, baseSha: "abc", createdAt: "2026-08-01T00:00:00.000Z", startedAt: null,
  dependsOn: [], blockedBy: [], autoMerge: null,
} as unknown as Spec;

const project = {
  id: "hanoman", name: "hanoman", desc: "", kind: "existing", repoDir: "/repo", binding: null,
  gitRemote: null, stack: "", docStatus: "ok", coverage: 100, createdAt: "2026-08-01T00:00:00.000Z",
  backlog: 1, topStage: "spec", session: { status: "idle", phase: null, flow: null },
  activity: "idle", commit: "—", helpEnabled: false, schedulerOptIn: false, leadOptIn: false,
  autoMerge: { mode: "default-branch", dest: "local", branch: null, deleteBranch: false },
} as never;

afterEach(() => vi.restoreAllMocks());
// `GET /specs` WAJIB dijawab dengan amplop paginasi utuh: layar menyetel ulang `data` dari
// respons itu, dan `{}` polos membuat `data.items` undefined → seluruh pohon crash saat
// re-render (gejalanya `undefined.map`, bukan assertion yang gagal).
const mockFetch = (rows: Spec[]) => vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
  const url = String(input);
  const value = url.includes("/branches")
    ? { branches: ["main", "develop"], remotes: ["main"], defaultBranch: "main" }
    : { items: rows, total: rows.length, page: 1, pageSize: 20 };
  return Promise.resolve({ ok: true, status: 200, json: async () => value } as Response);
});

const open = () => fireEvent.click(screen.getByText("Fitur"));

describe("override auto-merge per backlog item (SPEC-486)", () => {
  it("default menampilkan warisan project apa adanya", async () => {
    mockFetch([spec]);
    render(<BacklogScreen backlog={[spec]} projects={[project]} projectFilter="all"
      onProjectFilter={() => { }} onEditAutoMerge={() => { }} />);
    open();
    expect(await screen.findByText(/Ikut project \(auto-merge ke default branch repo \(lokal\)\)/)).toBeTruthy();
  });

  it("memilih \"tanpa auto-merge\" mengirim override off", async () => {
    mockFetch([spec]);
    const calls: unknown[] = [];
    render(<BacklogScreen backlog={[spec]} projects={[project]} projectFilter="all"
      onProjectFilter={() => { }} onEditAutoMerge={(s, v) => calls.push([s.id, v])} />);
    open();
    fireEvent.change(await screen.findByLabelText("Auto-merge item ini"), { target: { value: "off" } });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual(["SPEC-1", { mode: "off", dest: "local", branch: null, deleteBranch: false }]);
  });

  it("kembali ke \"ikut project\" mengirim null", async () => {
    const calls: unknown[] = [];
    const off = { ...spec, autoMerge: { mode: "off", dest: "local", branch: null, deleteBranch: false } } as never as Spec;
    mockFetch([off]);
    render(<BacklogScreen backlog={[off]} projects={[project]} projectFilter="all"
      onProjectFilter={() => { }} onEditAutoMerge={(s, v) => calls.push([s.id, v])} />);
    open();
    fireEvent.change(await screen.findByLabelText("Auto-merge item ini"), { target: { value: "inherit" } });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual(["SPEC-1", null]);
  });
});
