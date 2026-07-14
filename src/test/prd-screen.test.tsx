import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: {
    listPrds: vi.fn(async () => ({ items: [
      { slug: "jadwal-invoice", name: "jadwal-invoice.md", path: "docs/prd/jadwal-invoice.md", title: "Jadwal Invoice", live: false },
      { slug: "notifikasi", name: "notifikasi.md", path: "docs/prd/notifikasi.md", title: "Notifikasi Realtime", live: true },
    ] })),
    getPrd: vi.fn(async () => ({ path: "docs/prd/jadwal-invoice.md", content: "# Jadwal Invoice\n\nRingkasan PRD" })),
    startPrd: vi.fn(),
  },
  ApiError: class extends Error {},
}));
import { PrdScreen } from "../src/screens/PrdScreen";
import { api } from "../src/api/client";

const projects = [{ id: "p1", name: "P1" }] as any;
beforeEach(() => vi.clearAllMocks());

describe("PrdScreen", () => {
  it("mendaftar PRD dari server", async () => {
    render(<PrdScreen projects={projects} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    expect(screen.getByText("Notifikasi Realtime")).toBeTruthy();
    expect(screen.getByText("draft hidup")).toBeTruthy(); // notifikasi.live
    expect(api.listPrds).toHaveBeenCalledWith("p1");
  });

  it("preview PRD lalu take ke backlog dengan prefill", async () => {
    const onTake = vi.fn();
    render(<PrdScreen projects={projects} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={onTake} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    fireEvent.click(screen.getByText("Jadwal Invoice"));
    await waitFor(() => expect(api.getPrd).toHaveBeenCalledWith("p1", "docs/prd/jadwal-invoice.md"));
    fireEvent.click(await screen.findByRole("button", { name: /take ke backlog/i }));
    expect(onTake).toHaveBeenCalledWith(expect.objectContaining({
      project: "p1", title: "Jadwal Invoice", prdPath: "docs/prd/jadwal-invoice.md",
    }));
  });

  it("New PRD memanggil onNewPrd dengan brief", async () => {
    const onNew = vi.fn();
    render(<PrdScreen projects={projects} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={onNew} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy()); // daftar termuat → hanya tombol header
    fireEvent.click(screen.getByRole("button", { name: /prd baru/i }));
    const title = await screen.findByPlaceholderText(/Jadwal Invoice Berulang/i);
    fireEvent.change(title, { target: { value: "Fitur Baru" } });
    fireEvent.click(screen.getByRole("button", { name: /brainstorm prd/i }));
    expect(onNew).toHaveBeenCalledWith("p1", expect.objectContaining({ title: "Fitur Baru" }));
  });
});
