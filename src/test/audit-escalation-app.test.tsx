import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { startPrd: vi.fn(async () => ({ id: "prd-kuota-tenant" })) },
  ApiError: class extends Error {},
}));
import { NewPrdModal } from "../src/screens/PrdScreen";

const projects = [{ id: "p1", name: "P1" }] as never;

// SPEC-340 · ADR-0076 · modal brief PRD dipakai ulang untuk eskalasi audit → PRD.
describe("NewPrdModal ter-prefill dari audit (SPEC-340)", () => {
  it("mengisi judul/konteks/outcome dari prefill", async () => {
    render(<NewPrdModal projects={projects} defaultProject="p1" onClose={() => {}} onCreate={() => {}}
      prefill={{ title: "Kuota tenant", context: "dari audit SPEC-300", outcome: "kuota bisa diatur" }} />);
    expect(await screen.findByDisplayValue("Kuota tenant")).toBeTruthy();
    expect(screen.getByDisplayValue("dari audit SPEC-300")).toBeTruthy();
    expect(screen.getByDisplayValue("kuota bisa diatur")).toBeTruthy();
  });

  it("meneruskan brief ter-prefill ke onCreate", async () => {
    const onCreate = vi.fn();
    render(<NewPrdModal projects={projects} defaultProject="p1" onClose={() => {}} onCreate={onCreate}
      prefill={{ title: "Kuota tenant", context: "c", outcome: "o" }} />);
    fireEvent.click(screen.getByRole("button", { name: /brainstorm PRD/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]![0]).toBe("p1");
    expect(onCreate.mock.calls[0]![1].title).toBe("Kuota tenant");
  });

  it("lockProject mengunci pilihan project ke asal audit", () => {
    render(<NewPrdModal projects={projects} defaultProject="p1" onClose={() => {}} onCreate={() => {}}
      lockProject prefill={{ title: "T" }} />);
    expect((screen.getByLabelText("Project untuk PRD baru") as HTMLSelectElement).disabled).toBe(true);
  });

  it("tanpa prefill tetap kosong (perilaku lama)", () => {
    render(<NewPrdModal projects={projects} defaultProject="p1" onClose={() => {}} onCreate={() => {}} />);
    expect((screen.getByPlaceholderText(/Jadwal Invoice Berulang/i) as HTMLInputElement).value).toBe("");
  });
});
