import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EditProjectModal } from "../src/App";

const base = {
  id: "old-id", name: "Alpha", desc: "d", kind: "existing", repoDir: "/r", binding: null, gitRemote: null,
  stack: "ts", docStatus: "ok", coverage: 100, createdAt: "2026-07-10T00:00:00.000Z",
  backlog: 0, topStage: "spec", activity: "idle", commit: "—",
  session: { status: "idle", phase: null, flow: null },
} as const;
const vm = base as unknown as Parameters<typeof EditProjectModal>[0]["project"];

describe("EditProjectModal — edit ID (SPEC-255)", () => {
  it("menampilkan field ID terisi project.id dan mengirim id baru ke onSave", () => {
    const onSave = vi.fn();
    render(<EditProjectModal open project={vm} onClose={vi.fn()} onSave={onSave} />);
    // field ID hadir & terisi slug lama
    const idInput = screen.getByDisplayValue("old-id");
    expect(screen.getByText("ID project")).toBeInTheDocument();
    fireEvent.change(idInput, { target: { value: "new-id" } });
    fireEvent.click(screen.getByText("Simpan"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "new-id" }));
  });

  it("slug tak sah menonaktifkan submit (onSave tak terpanggil)", () => {
    const onSave = vi.fn();
    render(<EditProjectModal open project={vm} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByDisplayValue("old-id"), { target: { value: "Bad Slug" } });
    fireEvent.click(screen.getByText("Simpan"));
    expect(onSave).not.toHaveBeenCalled();
  });
});
