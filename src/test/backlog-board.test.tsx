import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen, specColumn, canDrop } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, ...over }) as Spec;

describe("specColumn", () => {
  it("spec tanpa run duduk di Backlog", () => {
    expect(specColumn(spec())).toBe("backlog");
  });
  it("stage done selalu Success, walau run terakhirnya gagal", () => {
    expect(specColumn(spec({ stage: "done" }), "failed")).toBe("success");
  });
  it("run terakhir failed/stopped menarik spec ke Failed, bukan ke stage-nya", () => {
    expect(specColumn(spec({ stage: "planned" }), "failed")).toBe("failed");
    expect(specColumn(spec({ stage: "planned" }), "stopped")).toBe("failed");
  });
  it("run hidup meninggalkan spec di kolom stage-nya", () => {
    expect(specColumn(spec({ stage: "executing" }), "running")).toBe("executing");
    expect(specColumn(spec({ stage: "brainstorming" }), "queued")).toBe("brainstorming");
  });
  it("stage maju tanpa run (run dihapus) tidak diklaim balik ke Backlog", () => {
    expect(specColumn(spec({ stage: "spec-ready" }))).toBe("spec-ready");
  });
});

describe("canDrop", () => {
  it("Backlog → Brainstorm diterima", () => {
    expect(canDrop("backlog", "brainstorming")).toBe(true);
  });
  /* Kontrak kanban: kartu mendarat di kolom tempat ia dijatuhkan. Run selalu mulai dari
     awal pipeline, jadi drop di Execute dulu menerimanya lalu melempar kartu ke Brainstorm. */
  it("Backlog → kolom kerja selain Brainstorm ditolak", () => {
    expect(canDrop("backlog", "objective")).toBe(false);
    expect(canDrop("backlog", "executing")).toBe(false);
  });
  it("Failed tidak bisa diseret — retry lewat tombol", () => {
    expect(canDrop("failed", "backlog")).toBe(false);
    expect(canDrop("failed", "brainstorming")).toBe(false);
  });
  it("kolom milik runner tidak menerima apa pun", () => {
    expect(canDrop("spec-ready", "executing")).toBe(false);
    expect(canDrop("executing", "done")).toBe(false);
    expect(canDrop("backlog", "success")).toBe(false);
    expect(canDrop("backlog", "failed")).toBe(false);
  });
});

/* Wiring: aturan di atas benar, tapi from/to bisa tertukar saat dipasang. Ini men-drag
   kartu sungguhan di jsdom, bukan memanggil canDrop lagi. */
const DRAGGABLE = "Seret ke Brainstorm untuk memulai run";
const RUNNER_OWNED = "Stage dikelola runner — kartu tak bisa dipindah";
const FAILED_HINT = "Run terakhir gagal — pakai tombol Jalankan lagi";
const dt = () => ({ dataTransfer: { setData: () => {}, effectAllowed: "", dropEffect: "" } });
const column = (label: string) => screen.getByText(label).closest("div")!.parentElement!;

function board(specs: Spec[], lastRunStatus?: Map<string, string>) {
  const onStart = vi.fn();
  render(<BacklogScreen backlog={specs} projects={[{ id: "p", name: "p" }] as never}
    lastRunStatus={lastRunStatus} onStart={onStart}
    projectFilter="all" onProjectFilter={() => {}} />);
  fireEvent.click(screen.getByText("Board"));
  return onStart;
}

describe("board drag (jsdom)", () => {
  it("Backlog → Brainstorm memanggil onStart dengan spec yang diseret", () => {
    const onStart = board([spec({ title: "bikin login" })]);
    fireEvent.dragStart(screen.getByTitle(DRAGGABLE), dt());
    fireEvent.drop(column("Brainstorm"), dt());
    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart.mock.calls[0]![0].id).toBe("SPEC-1");
  });

  it("Backlog → Execute ditolak: kartu akan mendarat di Brainstorm, bukan Execute", () => {
    const onStart = board([spec({ title: "bikin login" })]);
    fireEvent.dragStart(screen.getByTitle(DRAGGABLE), dt());
    fireEvent.drop(column("Execute"), dt());
    expect(onStart).not.toHaveBeenCalled();
  });

  it("Backlog → Success ditolak, tak ada run yang dimulai", () => {
    const onStart = board([spec({ title: "bikin login" })]);
    fireEvent.dragStart(screen.getByTitle(DRAGGABLE), dt());
    fireEvent.drop(column("Success"), dt());
    expect(onStart).not.toHaveBeenCalled();
  });

  /* Drag mati di keyboard dan layar sentuh, jadi tiap kartu board wajib punya tombolnya. */
  it("spec gagal tak bisa diseret, tapi tombol Jalankan lagi ada di kartunya", () => {
    const onStart = board([spec({ stage: "planned" })], new Map([["SPEC-1", "failed"]]));
    expect(screen.queryByTitle(DRAGGABLE)).toBeNull();
    expect(screen.getByTitle(FAILED_HINT).getAttribute("draggable")).toBe("false");
    fireEvent.click(screen.getByText("Jalankan lagi"));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("spec di Backlog punya tombol Mulai, bukan hanya drag", () => {
    const onStart = board([spec()]);
    fireEvent.click(screen.getByText("Mulai"));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("kartu di kolom milik runner tak bisa diangkat", () => {
    board([spec({ stage: "planned" })], new Map([["SPEC-1", "running"]]));
    expect(screen.getByTitle(RUNNER_OWNED).getAttribute("draggable")).toBe("false");
    expect(screen.queryByTitle(DRAGGABLE)).toBeNull();
  });
});
