import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
// SpecDetail memuat branches lewat api.listBranches di useEffect — mock supaya tak fetch nyata.
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const spec: Spec = {
  id: "SPEC-167", projectId: "p1", title: "T", source: "brief", stage: "planned",
  priority: "tinggi", author: "Rangga", objective: "obj", payload: {}, branchFrom: null,
} as Spec;

function renderScreen(onRevertStage: any) {
  return render(
    <BacklogScreen backlog={[spec]} projects={[{ id: "p1", name: "p1" } as any]}
      projectFilter="all" onProjectFilter={() => {}} onRevertStage={onRevertStage} />,
  );
}

describe("revert stage", () => {
  it("dropdown revert hanya menawarkan stage lebih awal dari current", async () => {
    renderScreen(vi.fn());
    fireEvent.click(screen.getByText("T"));                // buka detail modal
    const sel = await screen.findByLabelText("Kembalikan stage");
    const opts = [...sel.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    // current = planned → hanya brainstorming, objective, spec-ready
    expect(opts).toEqual(["brainstorming", "objective", "spec-ready"]);
  });

  it("pilih stage → panggil onRevertStage; jika pending, konfirmasi memanggil lagi dgn confirmDelete", async () => {
    const onRevert = vi.fn()
      .mockResolvedValueOnce({ pending: true, stage: "objective", wouldDelete: ["docs/superpowers/plans/x-spec-167.md"] })
      .mockResolvedValueOnce({ ...spec, stage: "objective" });
    renderScreen(onRevert);
    fireEvent.click(screen.getByText("T"));
    const sel = await screen.findByLabelText("Kembalikan stage");
    fireEvent.change(sel, { target: { value: "objective" } });
    // pickStage memanggil onRevertStage(spec, target) — dua argumen (dry-run).
    await waitFor(() => expect(onRevert).toHaveBeenCalledWith(spec, "objective"));
    // dialog konfirmasi menampilkan berkas
    expect(await screen.findByText(/x-spec-167\.md/)).toBeTruthy();
    fireEvent.click(screen.getByText("Hapus & kembalikan"));
    await waitFor(() => expect(onRevert).toHaveBeenCalledWith(spec, "objective", true));
  });
});
