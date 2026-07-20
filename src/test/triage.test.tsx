import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const TICKET: any = {
  id: "t1", projectId: "demo", number: 1, category: "bug", title: "Tak bisa login",
  reporterEmail: "r@e.co", status: "new", specId: null, attachmentCount: 0, createdAt: "2026-07-20T00:00:00Z",
};
const DETAIL: any = { ...TICKET, detail: "Detil keluhan", attachments: [], spec: null };

const { listTickets, getTicket, acceptTicket, rejectTicket } = vi.hoisted(() => ({
  listTickets: vi.fn(async () => ({ items: [TICKET], total: 1, page: 1, pageSize: 1, unreviewed: 1 })),
  getTicket: vi.fn(async () => DETAIL),
  acceptTicket: vi.fn(async () => ({ spec: { id: "SPEC-300", projectId: "demo" } })),
  rejectTicket: vi.fn(async () => ({ id: "t1", status: "rejected" })),
}));
vi.mock("../src/api/client", () => ({
  api: { listTickets, getTicket, acceptTicket, rejectTicket },
  ApiError: class extends Error {},
}));
import { TriageScreen } from "../src/screens/TriageScreen";

const projects: any = [{ id: "demo", name: "Demo" }];

describe("SPEC-253 · TriageScreen", () => {
  it("render daftar tiket + badge belum ditinjau", async () => {
    render(<TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />);
    expect(await screen.findByText("Tak bisa login")).toBeTruthy();
    expect(screen.getByText(/1 belum ditinjau/i)).toBeTruthy(); // badge (bukan opsi filter)
  });

  it("buka detail lalu Terima → memanggil acceptTicket + onAccepted", async () => {
    const onAccepted = vi.fn();
    render(<TriageScreen projects={projects} onAccepted={onAccepted} onToast={() => {}} />);
    fireEvent.click(await screen.findByText("Tak bisa login"));
    await screen.findByText(/Detil keluhan/);
    fireEvent.click(screen.getByRole("button", { name: /terima/i }));
    await waitFor(() => expect(acceptTicket).toHaveBeenCalledWith("t1", "sedang"));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  });
});
