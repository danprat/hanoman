import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
// SpecDetail memuat branches lewat api.listBranches di useEffect — mock supaya tak fetch nyata.
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const doneSpec: Spec = {
  id: "SPEC-162", projectId: "p1", title: "Reopenable", source: "brief", stage: "done",
  priority: "sedang", author: "Rangga", objective: "obj", payload: {}, branchFrom: null,
} as Spec;

function renderScreen(spec: Spec, onStart: any) {
  return render(
    <BacklogScreen backlog={[spec]} projects={[{ id: "p1", name: "p1" } as any]}
      projectFilter="all" onProjectFilter={() => {}} onStart={onStart} />,
  );
}

describe("reopen session (SPEC-172)", () => {
  it("detail spec done: tombol 'Buka sesi lagi' memanggil onStart", async () => {
    const onStart = vi.fn();
    renderScreen(doneSpec, onStart);
    fireEvent.click(screen.getByText("Reopenable")); // buka detail modal (title = TitleButton)
    const btn = await screen.findByText("Buka sesi lagi");
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledWith(doneSpec);
  });

  it("grid tidak menampilkan reopen untuk spec done — hanya badge 'selesai'", () => {
    renderScreen(doneSpec, vi.fn());
    expect(screen.getByText("selesai")).toBeTruthy();          // SpecActions cabang done
    expect(screen.queryByText("Buka sesi lagi")).toBeNull();   // tak bocor ke grid
  });

  it("detail spec non-done: tak ada tombol reopen", () => {
    renderScreen({ ...doneSpec, stage: "planned" }, vi.fn());
    fireEvent.click(screen.getByText("Reopenable"));
    expect(screen.queryByText("Buka sesi lagi")).toBeNull();
  });
});
