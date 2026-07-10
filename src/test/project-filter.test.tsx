import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";

const spec = (id: string, projectId: string) => ({
  id, projectId, title: id, source: "qa", stage: "planned", priority: "tinggi",
  author: "qa", objective: "", payload: null,
});

// RunsScreen hilang bersama subsistem run (SPEC-162); filter project-nya ikut. Backlog
// tetap menyaring, dan itulah satu-satunya layar berdaftar yang tersisa.
describe("filter project (SPEC-146)", () => {
  it("BacklogScreen hanya menampilkan spec milik project terpilih", () => {
    render(<BacklogScreen backlog={[spec("SPEC-1", "arta"), spec("SPEC-2", "kirana")] as never}
      projects={[{ id: "arta", name: "arta" }, { id: "kirana", name: "kirana" }] as never}
      projectFilter="arta" onProjectFilter={() => {}} />);
    expect(screen.getAllByText("SPEC-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("SPEC-2")).toBeNull();
  });

  it("BacklogScreen tanpa filter menampilkan semua spec", () => {
    render(<BacklogScreen backlog={[spec("SPEC-1", "arta"), spec("SPEC-2", "kirana")] as never}
      projects={[{ id: "arta", name: "arta" }, { id: "kirana", name: "kirana" }] as never}
      projectFilter="all" onProjectFilter={() => {}} />);
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });
});
