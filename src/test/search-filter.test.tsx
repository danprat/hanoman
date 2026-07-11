import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";

const spec = (over: Record<string, unknown>) => ({
  id: "SPEC-1", projectId: "arta", title: "t", source: "brief",
  stage: "planned", priority: "sedang", author: "a", objective: "", payload: null, branchFrom: null,
  ...over,
});

function renderBacklog(backlog: unknown[]) {
  return render(
    <BacklogScreen backlog={backlog as never}
      projects={[{ id: "arta", name: "arta" }] as never}
      projectFilter="all" onProjectFilter={() => {}} />
  );
}

describe("search + filter backlog (SPEC-178)", () => {
  it("search mencocokkan judul", () => {
    renderBacklog([
      spec({ id: "SPEC-1", title: "Login page" }),
      spec({ id: "SPEC-2", title: "Export CSV" }),
    ]);
    fireEvent.change(screen.getByPlaceholderText("Cari backlog…"), { target: { value: "csv" } });
    expect(screen.queryByText("SPEC-1")).toBeNull();
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });

  it("search mencocokkan objective (bukan hanya judul/id)", () => {
    renderBacklog([
      spec({ id: "SPEC-1", title: "A", objective: "perbaiki tombol simpan" }),
      spec({ id: "SPEC-2", title: "B", objective: "tambah ekspor pdf" }),
    ]);
    fireEvent.change(screen.getByPlaceholderText("Cari backlog…"), { target: { value: "ekspor" } });
    expect(screen.queryByText("SPEC-1")).toBeNull();
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });

  it("filter stage menyaring per stage", () => {
    renderBacklog([
      spec({ id: "SPEC-1", stage: "brainstorming" }),
      spec({ id: "SPEC-2", stage: "planned" }),
    ]);
    fireEvent.change(screen.getByLabelText("Filter stage"), { target: { value: "planned" } });
    expect(screen.queryByText("SPEC-1")).toBeNull();
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });

  it("filter prioritas menyaring per prioritas", () => {
    renderBacklog([
      spec({ id: "SPEC-1", priority: "tinggi" }),
      spec({ id: "SPEC-2", priority: "rendah" }),
    ]);
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "rendah" } });
    expect(screen.queryByText("SPEC-1")).toBeNull();
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });

  it("kombinasi search + stage + prioritas = irisan", () => {
    renderBacklog([
      spec({ id: "SPEC-1", title: "alpha", stage: "planned", priority: "tinggi" }),
      spec({ id: "SPEC-2", title: "alpha", stage: "planned", priority: "rendah" }),
      spec({ id: "SPEC-3", title: "beta", stage: "planned", priority: "tinggi" }),
    ]);
    fireEvent.change(screen.getByPlaceholderText("Cari backlog…"), { target: { value: "alpha" } });
    fireEvent.change(screen.getByLabelText("Filter stage"), { target: { value: "planned" } });
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    expect(screen.getAllByText("SPEC-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("SPEC-2")).toBeNull();
    expect(screen.queryByText("SPEC-3")).toBeNull();
  });

  it("tanpa filter menampilkan semua (tak menyaring)", () => {
    renderBacklog([spec({ id: "SPEC-1" }), spec({ id: "SPEC-2" })]);
    expect(screen.getAllByText("SPEC-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SPEC-2").length).toBeGreaterThan(0);
  });
});
