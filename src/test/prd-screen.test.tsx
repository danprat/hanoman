import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: {
    listPrds: vi.fn(async () => ({ items: [
      { slug: "jadwal-invoice", name: "jadwal-invoice.md", path: "docs/prd/jadwal-invoice.md", title: "Jadwal Invoice", live: false, projectId: "p1", projectName: "P1" },
      { slug: "notifikasi", name: "notifikasi.md", path: "docs/prd/notifikasi.md", title: "Notifikasi Realtime", live: true, projectId: "p1", projectName: "P1" },
    ] })),
    listAllPrds: vi.fn(async () => ({ items: [
      { slug: "jadwal-invoice", name: "jadwal-invoice.md", path: "docs/prd/jadwal-invoice.md", title: "Jadwal Invoice", live: false, projectId: "p1", projectName: "P1" },
      { slug: "auth", name: "auth.md", path: "docs/prd/auth.md", title: "Auth Device", live: false, projectId: "p2", projectName: "Proyek B" },
    ] })),
    getPrd: vi.fn(async () => ({ path: "docs/prd/jadwal-invoice.md", content: "# Jadwal Invoice\n\nRingkasan PRD" })),
    startPrd: vi.fn(),
  },
  ApiError: class extends Error {},
}));
import { PrdScreen } from "../src/screens/PrdScreen";
import { api } from "../src/api/client";

const projects = [{ id: "p1", name: "P1" }, { id: "p2", name: "Proyek B" }] as any;
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

  it("New PRD: modal punya Select project (default = filter aktif), kirim project itu ke onNewPrd", async () => {
    const onNew = vi.fn();
    render(<PrdScreen projects={projects} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={onNew} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy()); // daftar termuat → hanya tombol header
    fireEvent.click(screen.getByRole("button", { name: /prd baru/i }));
    const projectSel = await screen.findByLabelText("Project untuk PRD baru");
    expect((projectSel as HTMLSelectElement).value).toBe("p1"); // default ikut filter aktif
    const title = await screen.findByPlaceholderText(/Jadwal Invoice Berulang/i);
    fireEvent.change(title, { target: { value: "Fitur Baru" } });
    fireEvent.click(screen.getByRole("button", { name: /brainstorm prd/i }));
    expect(onNew).toHaveBeenCalledWith("p1", expect.objectContaining({ title: "Fitur Baru" }));
  });

  it("mode 'Semua project': tombol PRD baru aktif; pilih project di modal tanpa filter list dulu", async () => {
    const onNew = vi.fn();
    render(<PrdScreen projects={projects} projectFilter="all" onProjectFilter={() => {}} onNewPrd={onNew} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(api.listAllPrds).toHaveBeenCalled());
    const btn = screen.getByRole("button", { name: /prd baru/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false); // tak lagi digate filter "Semua project"
    fireEvent.click(btn);
    const projectSel = await screen.findByLabelText("Project untuk PRD baru");
    fireEvent.change(projectSel, { target: { value: "p2" } }); // pilih project di dalam modal
    const title = await screen.findByPlaceholderText(/Jadwal Invoice Berulang/i);
    fireEvent.change(title, { target: { value: "Fitur Lintas" } });
    fireEvent.click(screen.getByRole("button", { name: /brainstorm prd/i }));
    expect(onNew).toHaveBeenCalledWith("p2", expect.objectContaining({ title: "Fitur Lintas" }));
  });

  it("mode 'Semua project' melist PRD lintas-project dikelompokkan per project", async () => {
    render(<PrdScreen projects={projects} projectFilter="all" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(api.listAllPrds).toHaveBeenCalled());
    expect(api.listPrds).not.toHaveBeenCalled();
    // item lintas-project
    expect(await screen.findByText("Jadwal Invoice")).toBeTruthy();
    expect(screen.getByText("Auth Device")).toBeTruthy();
    // header grup per project (di sidebar, bukan opsi dropdown yang juga bernama "Proyek B")
    const list = screen.getByLabelText("Daftar PRD");
    expect(within(list).getByText("Proyek B")).toBeTruthy();
  });

  it("mode 'Semua project': preview pakai projectId item, take prefill project item", async () => {
    const onTake = vi.fn();
    render(<PrdScreen projects={projects} projectFilter="all" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={onTake} />);
    fireEvent.click(await screen.findByText("Auth Device"));
    await waitFor(() => expect(api.getPrd).toHaveBeenCalledWith("p2", "docs/prd/auth.md"));
    fireEvent.click(await screen.findByRole("button", { name: /take ke backlog/i }));
    expect(onTake).toHaveBeenCalledWith(expect.objectContaining({ project: "p2", prdPath: "docs/prd/auth.md" }));
  });
});
