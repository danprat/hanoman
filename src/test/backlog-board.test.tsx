import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen, specColumn, canDrop } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, ...over }) as Spec;

describe("specColumn", () => {
  it("spec tanpa sesi duduk di Backlog", () => {
    expect(specColumn(spec())).toBe("backlog");
  });
  it("stage done selalu Success", () => {
    expect(specColumn(spec({ stage: "done" }), true)).toBe("success");
  });
  it("sesi hidup di stage awal memindahkan kartu keluar dari Backlog", () => {
    expect(specColumn(spec({ stage: "brainstorming" }), true)).toBe("brainstorming");
  });
  it("sesi hidup meninggalkan spec di kolom stage-nya", () => {
    expect(specColumn(spec({ stage: "executing" }), true)).toBe("executing");
  });
  it("stage maju tanpa sesi tidak diklaim balik ke Backlog", () => {
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
  it("kolom yang mengikuti fase agen tidak menerima apa pun", () => {
    expect(canDrop("spec-ready", "executing")).toBe(false);
    expect(canDrop("executing", "done")).toBe(false);
    expect(canDrop("backlog", "success")).toBe(false);
  });
});

/* Wiring: aturan di atas benar, tapi from/to bisa tertukar saat dipasang. Ini men-drag
   kartu sungguhan di jsdom, bukan memanggil canDrop lagi. */
const DRAGGABLE = "Seret ke Brainstorm untuk memulai sesi";
const AGENT_OWNED = "Stage mengikuti fase yang dilaporkan agen — kartu tak bisa dipindah";
const dt = () => ({ dataTransfer: { setData: () => {}, effectAllowed: "", dropEffect: "" } });
// { selector: "span" } — sejak SPEC-178 label stage juga muncul di <option> filter stage;
// header kolom board adalah <span class="hn-eyebrow">, jadi scope ke span agar tak ambigu.
const column = (label: string) => screen.getByText(label, { selector: "span" }).closest("div")!.parentElement!;

function board(specs: Spec[], activeSpecs?: Set<string>) {
  const onStart = vi.fn();
  render(<BacklogScreen backlog={specs} projects={[{ id: "p", name: "p" }] as never}
    activeSpecs={activeSpecs} onStart={onStart}
    projectFilter="all" onProjectFilter={() => {}} />);
  fireEvent.click(screen.getByText("Board"));
  return onStart;
}

describe("tombol Review (SPEC-171)", () => {
  it("klik Review memanggil onOpenReview dengan spec-nya", () => {
    const onOpenReview = vi.fn();
    render(<BacklogScreen backlog={[spec({ title: "x" })]} projects={[{ id: "p", name: "p" }] as never}
      onOpenReview={onOpenReview} projectFilter="all" onProjectFilter={() => {}} />);
    fireEvent.click(screen.getByText("Review"));
    expect(onOpenReview).toHaveBeenCalledOnce();
    expect(onOpenReview.mock.calls[0]![0].id).toBe("SPEC-1");
  });
});

describe("Integrasi rebase/merge (SPEC-175)", () => {
  it("SpecDetail spec done menampilkan aksi Rebase / Merge", async () => {
    render(<BacklogScreen backlog={[spec({ id: "SPEC-9", stage: "done", title: "done spec" })]}
      projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onIntegrate={() => {}} />);
    fireEvent.click(screen.getByText("done spec"));            // buka detail
    fireEvent.click(await screen.findByRole("button", { name: /rebase \/ merge/i }));
    expect(await screen.findByLabelText("Target")).toBeTruthy();
  });
  it("SpecDetail spec belum done tak menampilkan Rebase / Merge", () => {
    render(<BacklogScreen backlog={[spec({ id: "SPEC-8", stage: "planned", title: "wip spec" })]}
      projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} onIntegrate={() => {}} />);
    fireEvent.click(screen.getByText("wip spec"));
    expect(screen.queryByRole("button", { name: /rebase \/ merge/i })).toBeNull();
  });
});

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

  it("Backlog → Success ditolak, tak ada sesi yang dimulai", () => {
    const onStart = board([spec({ title: "bikin login" })]);
    fireEvent.dragStart(screen.getByTitle(DRAGGABLE), dt());
    fireEvent.drop(column("Success"), dt());
    expect(onStart).not.toHaveBeenCalled();
  });

  /* Drag mati di keyboard dan layar sentuh, jadi tiap kartu board wajib punya tombolnya. */
  it("spec yang stage-nya maju tanpa sesi tak bisa diseret, tapi punya tombol Lanjutkan", () => {
    const onStart = board([spec({ stage: "planned" })]);
    expect(screen.queryByTitle(DRAGGABLE)).toBeNull();
    expect(screen.getByTitle(AGENT_OWNED).getAttribute("draggable")).toBe("false");
    fireEvent.click(screen.getByText("Lanjutkan"));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("spec di Backlog punya tombol Mulai, bukan hanya drag", () => {
    const onStart = board([spec()]);
    fireEvent.click(screen.getByText("Mulai"));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("kartu spec dengan sesi hidup tak bisa diangkat", () => {
    board([spec({ stage: "planned" })], new Set(["SPEC-1"]));
    expect(screen.getByTitle(AGENT_OWNED).getAttribute("draggable")).toBe("false");
    expect(screen.queryByTitle(DRAGGABLE)).toBeNull();
  });
});
