import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: ["main", "hanoman/spec-1"], remotes: ["main"] })) },
}));
import { IntegrateDialog } from "../src/screens/IntegrateDialog";

describe("IntegrateDialog", () => {
  it("target-nya mengecualikan ownBranch, dan Merge memanggil onIntegrate", async () => {
    const onIntegrate = vi.fn();
    // SPEC-230 · dialog kini generik: projectId + ownBranch (branch spec ATAU branch sesi PRD).
    render(<IntegrateDialog projectId="p" ownBranch="hanoman/spec-1" eyebrow="SPEC-1"
      onClose={() => {}} onIntegrate={onIntegrate} />);
    const select = (await screen.findByLabelText("Target")) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("local:main");
    expect(values).toContain("origin:main");
    // hanoman/spec-1 = ownBranch → bukan target
    expect(values).not.toContain("local:hanoman/spec-1");
    fireEvent.change(select, { target: { value: "origin:main" } });
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    await waitFor(() => expect(onIntegrate).toHaveBeenCalledWith("merge", "origin:main"));
  });

  it("ownBranch sesi PRD (prd/<slug>) dikecualikan dari target", async () => {
    const onIntegrate = vi.fn();
    render(<IntegrateDialog projectId="p" ownBranch="prd/jadwal-invoice" eyebrow="prd-jadwal-invoice"
      onClose={() => {}} onIntegrate={onIntegrate} />);
    const select = (await screen.findByLabelText("Target")) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("origin:main");
    expect(values).not.toContain("local:prd/jadwal-invoice");
  });
});
