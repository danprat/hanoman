import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// SPEC-198 · ProjectsScreen: baris via API (search+paginasi), StatStrip dari props penuh.
vi.mock("../src/api/client", () => ({
  api: { listProjects: vi.fn() },
  ApiError: class extends Error {},
}));
import { ProjectsScreen } from "../src/screens/ProjectsScreen";
import { api } from "../src/api/client";

const P = (over: Record<string, unknown> = {}) => ({
  id: "arta", name: "arta", desc: "", kind: "existing", stack: "",
  docStatus: "ok", coverage: 90, createdAt: "", backlog: 3, topStage: "execute",
  session: { status: "idle", phase: "", flow: "feature" }, activity: "", commit: "", ...over,
});
const envelope = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
beforeEach(() => { vi.mocked(api.listProjects).mockReset(); });

describe("ProjectsScreen via API (SPEC-198)", () => {
  it("fetch baris dengan q; render item server (bukan prop penuh)", async () => {
    vi.mocked(api.listProjects).mockResolvedValue(envelope([P({ id: "beta", name: "beta" })]));
    const full = [P({ id: "arta", name: "arta" }), P({ id: "gamma", name: "gamma" }), P({ id: "beta", name: "beta" })];
    render(<ProjectsScreen projects={full as never} search="beta" pageSize={20} dataVersion={0} />);
    await waitFor(() => expect(screen.queryByText("gamma")).toBeNull()); // server menyaring
    expect(screen.getByText("beta")).toBeTruthy();
    const params = vi.mocked(api.listProjects).mock.calls.at(-1)![0];
    expect(params).toMatchObject({ q: "beta", page: 1, limit: 20 });
  });

  it("rows kosong + search → empty state 'tidak ada cocok'", async () => {
    vi.mocked(api.listProjects).mockResolvedValue(envelope([]));
    render(<ProjectsScreen projects={[P()] as never} search="zzz" pageSize={20} onClearSearch={() => {}} />);
    expect(await screen.findByText(/Tidak ada project cocok/)).toBeTruthy();
  });
});
