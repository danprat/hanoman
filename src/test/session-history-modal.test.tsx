import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listSessionHistory = vi.fn();
const sessionTranscript = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    listSessionHistory: (...a: unknown[]) => listSessionHistory(...a),
    sessionTranscript: (...a: unknown[]) => sessionTranscript(...a),
  },
  ApiError: class extends Error {},
}));
import { SessionHistoryModal } from "../src/screens/SessionHistoryModal";

const row = (over: Record<string, unknown> = {}) => ({
  id: "h1", sessionId: "spec-362", projectId: "p1", specId: "SPEC-362", title: "History session terminal",
  kind: "spec", flow: "feature", agent: "claude", model: "claude-opus-5", effort: "xhigh",
  branch: null, cwd: "/r/.worktrees/spec-362", startedAt: "2026-07-28T01:00:00.000Z",
  endedAt: "2026-07-28T02:00:00.000Z", exitCode: 0, transcriptBytes: 42, ...over,
});

beforeEach(() => {
  listSessionHistory.mockReset(); sessionTranscript.mockReset();
});

const projects = [{ id: "p1", name: "hanoman" }];

describe("SessionHistoryModal (SPEC-362)", () => {
  it("merender baris riwayat dengan label kind manusia, bukan slug", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("History session terminal")).toBeTruthy();
    // "Backlog" juga muncul sebagai <option> di filter jenis — yang diuji adalah BADGE di barisnya.
    expect(screen.getAllByText("Backlog").some((el) => el.tagName !== "OPTION")).toBe(true);
    expect(screen.queryByText("spec")).toBeNull();        // slug mentah tak pernah dirender
  });

  it("sesi yang belum ditutup terbaca 'berjalan'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ endedAt: null, exitCode: null })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("berjalan")).toBeTruthy();
  });

  it("Muat lebih MENAMBAH halaman berikutnya, bukan menggantinya", async () => {
    listSessionHistory
      .mockResolvedValueOnce({ items: [row({ id: "h1", title: "Pertama" })], total: 2, page: 1, pageSize: 1 })
      .mockResolvedValueOnce({ items: [row({ id: "h2", title: "Kedua" })], total: 2, page: 2, pageSize: 1 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("Pertama")).toBeTruthy();
    fireEvent.click(screen.getByText("Muat lebih"));
    await waitFor(() => expect(screen.getByText("Kedua")).toBeTruthy());
    expect(screen.getByText("Pertama")).toBeTruthy();   // yang lama tetap ada
  });

  it("baris penutup membedakan 'masih ada' dari 'seluruh riwayat'", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText(/seluruh riwayat/)).toBeTruthy();
    expect(screen.queryByText("Muat lebih")).toBeNull();
  });

  it("filter project memanggil ulang API dengan projectId", async () => {
    listSessionHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    await waitFor(() => expect(listSessionHistory).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Filter project"), { target: { value: "p1" } });
    await waitFor(() =>
      expect(listSessionHistory.mock.calls.at(-1)?.[0]).toMatchObject({ projectId: "p1", page: 1 }));
  });

  it("riwayat kosong menampilkan StateBlock, bukan daftar kosong tanpa penjelasan", async () => {
    listSessionHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("Belum ada riwayat sesi")).toBeTruthy();
  });
});

describe("SessionHistoryModal — detail (SPEC-362)", () => {
  it("klik baris memuat transkrip dan menampilkannya", async () => {
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    sessionTranscript.mockResolvedValue({ text: "PENANDA-TRANSKRIP", bytes: 17 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    expect(await screen.findByText(/PENANDA-TRANSKRIP/)).toBeTruthy();
  });

  it("baris tanpa transkrip tak memanggil endpoint transkrip", async () => {
    listSessionHistory.mockResolvedValue({ items: [row({ transcriptBytes: null })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    expect(await screen.findByText(/Tanpa transkrip/)).toBeTruthy();
    expect(sessionTranscript).not.toHaveBeenCalled();
  });

  it("'Mulai lagi' memanggil onRestart dengan barisnya (kind restartable)", async () => {
    const onRestart = vi.fn();
    listSessionHistory.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
    sessionTranscript.mockResolvedValue({ text: "x", bytes: 1 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={onRestart} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    fireEvent.click(await screen.findByText("Mulai lagi"));
    expect(onRestart).toHaveBeenCalledWith(expect.objectContaining({ id: "h1" }));
  });

  it("kind tak restartable tak menawarkan 'Mulai lagi'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ kind: "prd", title: "PRD sesuatu", transcriptBytes: null })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("PRD sesuatu"));
    expect(await screen.findByText(/Tanpa transkrip/)).toBeTruthy();
    expect(screen.queryByText("Mulai lagi")).toBeNull();
  });
});
