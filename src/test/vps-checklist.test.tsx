import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ChecklistView, ChecklistItem } from "@hanoman/shared";

const item = (over: Partial<ChecklistItem> & { id: string }): ChecklistItem => ({
  section: "ssh", sectionTitle: "SSH Hardening", level: "Basic", title: over.id,
  mode: "AUDIT", severity: "high", probe: true, remediable: false, appLayer: false,
  status: "unknown", na: false, attested: false, actorEmail: null, naReason: null, attestNote: null,
  ...over,
});

const VIEW: ChecklistView = {
  vpsId: "v1", scoreTotal: 42, lastAuditAt: null,
  scoreBySection: { ssh: 50, firewall: 0 },
  sections: [
    { id: "ssh", title: "SSH Hardening", icon: "🔑", score: 50, items: [
      item({ id: "ssh-b2", title: "Nonaktifkan login root", mode: "AUDIT", severity: "critical", status: "fail" }),
      item({ id: "ssh-a1", title: "SSH Certificate Authority", mode: "INFO", level: "Advanced", status: "unknown", probe: false }),
    ] },
    { id: "firewall", title: "Firewall & Network", icon: "🔥", score: 0, items: [
      item({ id: "fw-b1", section: "firewall", sectionTitle: "Firewall & Network", title: "Aktifkan UFW", mode: "AUTO", severity: "critical", status: "pass" }),
    ] },
  ],
};

const { vpsChecklist, markNa, attestItem } = vi.hoisted(() => ({
  vpsChecklist: vi.fn(),
  markNa: vi.fn(async () => ({ ok: true })),
  attestItem: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../src/api/client", () => ({
  api: { vpsChecklist, markNa, attestItem },
  ApiError: class extends Error {},
}));
import { VpsChecklist } from "../src/screens/VpsChecklist";

describe("VpsChecklist (SPEC-220)", () => {
  beforeEach(() => { vpsChecklist.mockResolvedValue(VIEW); markNa.mockClear(); attestItem.mockClear(); });

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
});
