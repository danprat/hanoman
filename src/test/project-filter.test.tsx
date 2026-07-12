import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// SPEC-198 · filter project kini via API: BacklogScreen mengirim `project` (dari projectFilter)
// ke listSpecs, server yang menyaring. Test memverifikasi param, bukan penyaringan klien.
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";

const envelope = (items: unknown[] = []) => ({ items, total: items.length, page: 1, pageSize: 20 });
beforeEach(() => { vi.mocked(api.listSpecs).mockReset(); vi.mocked(api.listSpecs).mockResolvedValue(envelope()); });
const lastParams = () => vi.mocked(api.listSpecs).mock.calls.at(-1)![0];
const projects = [{ id: "arta", name: "arta" }, { id: "kirana", name: "kirana" }] as never;

// RunsScreen hilang bersama subsistem run (SPEC-162); filter project-nya ikut. Backlog
// tetap menyaring, dan itulah satu-satunya layar berdaftar yang tersisa.
describe("filter project via API (SPEC-146 → SPEC-198)", () => {
  it("BacklogScreen fetch dengan param project = projectFilter", async () => {
    render(<BacklogScreen backlog={[] as never} projects={projects}
      projectFilter="arta" onProjectFilter={() => {}} />);
    await waitFor(() => expect(lastParams()).toMatchObject({ project: "arta" }));
  });

  it("projectFilter=all → tanpa param project (server balikkan semua)", async () => {
    render(<BacklogScreen backlog={[] as never} projects={projects}
      projectFilter="all" onProjectFilter={() => {}} />);
    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    expect(lastParams()).toMatchObject({ project: undefined });
  });
});
