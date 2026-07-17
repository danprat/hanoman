import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ChecklistView, ChecklistItem } from "@hanoman/shared";

const item = (over: Partial<ChecklistItem> & { id: string }): ChecklistItem => ({
  section: "ssh", sectionTitle: "SSH Hardening", level: "Basic", title: over.id,
  mode: "AUDIT", severity: "high", probe: true, remediable: false, appLayer: false,
  status: "unknown", na: false, attested: false, drifted: false,
  actorEmail: null, naReason: null, attestNote: null,
  ...over,
});

const VIEW: ChecklistView = {
  vpsId: "v1", scoreTotal: 42, lastAuditAt: null,
  scoreBySection: { ssh: 50, firewall: 0 },
  sections: [
    { id: "ssh", title: "SSH Hardening", icon: "🔑", score: 50, items: [
      item({ id: "ssh-b2", title: "Nonaktifkan login root", mode: "AUDIT", severity: "critical", status: "fail" }),
      item({ id: "ssh-b3", title: "Nonaktifkan password login", mode: "AUDIT", severity: "critical", status: "fail", drifted: true }),
      item({ id: "ssh-a1", title: "SSH Certificate Authority", mode: "INFO", level: "Advanced", status: "unknown", probe: false }),
    ] },
    { id: "firewall", title: "Firewall & Network", icon: "🔥", score: 0, items: [
      item({ id: "fw-b1", section: "firewall", sectionTitle: "Firewall & Network", title: "Aktifkan UFW", mode: "AUTO", severity: "critical", status: "pass" }),
    ] },
    { id: "webserver", title: "Web Server Hardening", icon: "🌐", score: 0,
      suggestion: { applicable: false, detail: "tak ada nginx/apache" }, items: [
      item({ id: "ws-b1", section: "webserver", sectionTitle: "Web Server Hardening", title: "Sembunyikan versi", mode: "INFO", appLayer: true, status: "unknown", probe: false }),
    ] },
  ],
};

const { vpsChecklist, markNa, attestItem, remediatePreview, remediate, markNaBulk } = vi.hoisted(() => ({
  vpsChecklist: vi.fn(),
  markNa: vi.fn(async () => ({ ok: true })),
  attestItem: vi.fn(async () => ({ ok: true })),
  remediatePreview: vi.fn(async () => ({ steps: [{ item: "fw-b1", status: "would", detail: "akan" }] })),
  remediate: vi.fn(async () => ({ steps: [{ item: "fw-b1", status: "ok", detail: "" }], audit: null, scoreTotal: 5, scoreBySection: {} })),
  markNaBulk: vi.fn(async () => ({ ok: true, count: 1 })),
}));
vi.mock("../src/api/client", () => ({
  api: { vpsChecklist, markNa, attestItem, remediatePreview, remediate, markNaBulk },
  ApiError: class extends Error {},
}));
import { VpsChecklist } from "../src/screens/VpsChecklist";

describe("VpsChecklist (SPEC-220)", () => {
  beforeEach(() => { vpsChecklist.mockResolvedValue(VIEW); markNa.mockClear(); attestItem.mockClear(); markNaBulk.mockClear(); });

  it("render skor total + seksi + item (AC-9)", async () => {
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    expect((await screen.findByTestId("score-total")).textContent).toBe("42%");
    expect(screen.getAllByText("SSH Hardening").length).toBeGreaterThan(0); // header + opsi filter
    expect(screen.getByText("Nonaktifkan login root")).toBeTruthy();
    expect(screen.getByText("Aktifkan UFW")).toBeTruthy();
  });

  it("tombol Attest hanya untuk item INFO (AC-11)", async () => {
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    await screen.findByTestId("score-total");
    // ssh-a1 INFO → punya Attest; ssh-b2 AUDIT → tidak
    const infoRow = screen.getByTestId("item-ssh-a1");
    expect(within(infoRow).queryByRole("button", { name: /attest/i })).toBeTruthy();
    const auditRow = screen.getByTestId("item-ssh-b2");
    expect(within(auditRow).queryByRole("button", { name: /attest/i })).toBeNull();
  });

  it("klik N/A memanggil api.markNa (AC-10)", async () => {
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    await screen.findByTestId("score-total");
    const row = screen.getByTestId("item-ssh-b2");
    fireEvent.click(within(row).getByRole("button", { name: /^n\/a$/i }));
    await vi.waitFor(() => expect(markNa).toHaveBeenCalledWith("v1", "ssh-b2", true, expect.any(String)));
  });

  it("klik Attest memanggil api.attestItem (AC-11)", async () => {
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    await screen.findByTestId("score-total");
    const row = screen.getByTestId("item-ssh-a1");
    fireEvent.click(within(row).getByRole("button", { name: /attest/i }));
    await vi.waitFor(() => expect(attestItem).toHaveBeenCalledWith("v1", "ssh-a1"));
  });

  it("filter mode=INFO menyembunyikan item non-INFO (AC-12)", async () => {
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    await screen.findByTestId("score-total");
    fireEvent.change(screen.getByLabelText("mode"), { target: { value: "INFO" } });
    expect(screen.queryByText("Nonaktifkan login root")).toBeNull(); // AUDIT tersembunyi
    expect(screen.getByText("SSH Certificate Authority")).toBeTruthy(); // INFO tampil
  });

  it("hanya item AUTO punya checkbox seleksi (AC-13)", async () => {
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    await screen.findByTestId("score-total");
    expect(within(screen.getByTestId("item-fw-b1")).queryByRole("checkbox")).toBeTruthy();   // AUTO
    expect(within(screen.getByTestId("item-ssh-b2")).queryByRole("checkbox")).toBeNull();    // AUDIT
    expect(within(screen.getByTestId("item-ssh-a1")).queryByRole("checkbox")).toBeNull();    // INFO
  });

  it("pilih AUTO → Preview memanggil api.remediatePreview + tampil would (AC-13)", async () => {
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    await screen.findByTestId("score-total");
    fireEvent.click(within(screen.getByTestId("item-fw-b1")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    await vi.waitFor(() => expect(remediatePreview).toHaveBeenCalledWith("v1", ["fw-b1"]));
    expect(within(await screen.findByTestId("remediate-preview")).getByText(/fw-b1/)).toBeTruthy();
  });

  it("Apply memanggil api.remediate (AC-14)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    await screen.findByTestId("score-total");
    fireEvent.click(within(screen.getByTestId("item-fw-b1")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /^apply/i }));
    await vi.waitFor(() => expect(remediate).toHaveBeenCalledWith("v1", ["fw-b1"]));
  });

  // --- SPEC-221 Fase 3 ---
  it("item drifted menampilkan penanda drift + ringkasan header (AC-19)", async () => {
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    await screen.findByTestId("score-total");
    const drifted = screen.getByTestId("item-ssh-b3");
    expect(within(drifted).getByText(/drift/i)).toBeTruthy();       // badge di baris item
    expect(screen.getByTestId("drift-summary").textContent).toMatch(/1 item/); // ringkasan header
  });

  it("seksi app-layer stack absent → banner saran + tombol Tandai seksi N/A memanggil markNaBulk", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    await screen.findByTestId("score-total");
    const banner = screen.getByTestId("suggestion-webserver");
    expect(banner).toBeTruthy();
    fireEvent.click(within(banner).getByRole("button", { name: /tandai seksi n\/a/i }));
    await vi.waitFor(() => expect(markNaBulk).toHaveBeenCalledWith("v1", ["ws-b1"], true, expect.any(String)));
  });

  it("seksi non-app-layer TIDAK menampilkan banner saran", async () => {
    render(<VpsChecklist vpsId="v1" onToast={() => {}} />);
    await screen.findByTestId("score-total");
    expect(screen.queryByTestId("suggestion-ssh")).toBeNull();
  });
});
