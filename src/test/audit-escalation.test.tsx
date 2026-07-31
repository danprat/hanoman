import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Pola backlog-board.test.tsx: klien di-mock penuh; BacklogScreen render dari prop `backlog`.
vi.mock("../src/api/client", () => ({
  api: {
    listBranches: vi.fn(async () => ({ branches: [], remotes: [] })),
    listSpecs: vi.fn(),
    getEscalation: vi.fn(async () => ({ escalation: null, docPath: null, live: false })),
  },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";
import type { Spec } from "../src/screens/types";

const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-300", projectId: "p", title: "audit antrean", source: "audit", stage: "done",
     priority: "tinggi", author: "Audit · a", objective: "telusuri", payload: {},
     branchFrom: null, baseSha: null, ...over }) as Spec;

const esc = (over: Record<string, unknown> = {}) => ({
  target: "prd", reason: "lintas modul", alternatives: ["brief"],
  prefill: { title: "Kuota tenant", context: "c", outcome: "o", constraints: "", severity: "", steps: "" },
  ...over });

const handlers = {
  onPromoteToQa: vi.fn(), onPromoteToBrief: vi.fn(), onPromoteToPrd: vi.fn(),
};

function openDetail(s: Spec, props: Record<string, unknown> = {}) {
  render(<BacklogScreen backlog={[s]} projects={[{ id: "p", name: "p" }] as never}
    projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} {...handlers} {...props} />);
  fireEvent.click(screen.getByText(s.title));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getEscalation).mockResolvedValue({ escalation: null, docPath: null, live: false } as never);
});

// SPEC-340 · ADR-0076 · audit punya TIGA pintu eskalasi, rekomendasi hanoman disorot.
describe("SpecDetail eskalasi audit (SPEC-340)", () => {
  it("menampilkan tiga tombol eskalasi untuk source audit", async () => {
    openDetail(spec());
    expect(await screen.findByRole("button", { name: /jadikan finding qa/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /jadikan feature brief/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /jadikan prd/i })).toBeTruthy();
  });

  it("menyorot target rekomendasi beserta alasannya", async () => {
    vi.mocked(api.getEscalation).mockResolvedValue({ escalation: esc(), docPath: "d.md", live: false } as never);
    openDetail(spec());
    expect(await screen.findByText(/direkomendasikan hanoman/i)).toBeTruthy();
    expect(screen.getByText(/lintas modul/)).toBeTruthy();
  });

  it("target none merender catatan cukup jawaban, tombol tetap ada", async () => {
    vi.mocked(api.getEscalation).mockResolvedValue({
      escalation: esc({ target: "none", reason: "sudah terjawab", alternatives: [] }),
      docPath: "d.md", live: false } as never);
    openDetail(spec());
    expect(await screen.findByText(/cukup jawaban/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /jadikan prd/i })).toBeTruthy();
  });

  it("tombol brief memanggil onPromoteToBrief membawa rekomendasi", async () => {
    const e = esc({ target: "brief", reason: "fitur kecil", alternatives: [] });
    vi.mocked(api.getEscalation).mockResolvedValue({ escalation: e, docPath: "d.md", live: false } as never);
    openDetail(spec());
    await screen.findByText(/direkomendasikan hanoman/i);
    fireEvent.click(screen.getByRole("button", { name: /jadikan feature brief/i }));
    await waitFor(() => expect(handlers.onPromoteToBrief).toHaveBeenCalledOnce());
    expect(handlers.onPromoteToBrief.mock.calls[0]![0].id).toBe("SPEC-300");
    expect(handlers.onPromoteToBrief.mock.calls[0]![1].prefill.title).toBe("Kuota tenant");
  });

  it("tombol PRD memanggil onPromoteToPrd", async () => {
    openDetail(spec());
    fireEvent.click(await screen.findByRole("button", { name: /jadikan prd/i }));
    await waitFor(() => expect(handlers.onPromoteToPrd).toHaveBeenCalledOnce());
    expect(handlers.onPromoteToPrd.mock.calls[0]![1]).toBeNull();   // tanpa rekomendasi terbaca
  });

  it("source brief tak menampilkan tombol eskalasi & tak memanggil endpoint", async () => {
    openDetail(spec({ id: "SPEC-302", title: "brief x", source: "brief" }));
    await screen.findAllByText("brief x");   // kartu + judul modal
    expect(screen.queryByRole("button", { name: /jadikan prd/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /jadikan finding qa/i })).toBeNull();
    expect(api.getEscalation).not.toHaveBeenCalled();
  });
});
