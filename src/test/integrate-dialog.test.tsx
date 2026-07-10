import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: ["main", "hanoman/spec-1"], remotes: ["main"] })) },
}));
import { IntegrateDialog } from "../src/screens/IntegrateDialog";
import type { Spec } from "../src/screens/types";

const spec = { id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "done",
  priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null } as Spec;

describe("IntegrateDialog", () => {
  it("target-nya mengecualikan branch spec sendiri, dan Merge memanggil onIntegrate", async () => {
    const onIntegrate = vi.fn();
    render(<IntegrateDialog spec={spec} onClose={() => {}} onIntegrate={onIntegrate} />);
    const select = (await screen.findByLabelText("Target")) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("local:main");
    expect(values).toContain("origin:main");
    // hanoman/spec-1 = branch spec sendiri → bukan target
    expect(values).not.toContain("local:hanoman/spec-1");
    fireEvent.change(select, { target: { value: "origin:main" } });
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    await waitFor(() => expect(onIntegrate).toHaveBeenCalledWith("merge", "origin:main"));
  });
});
