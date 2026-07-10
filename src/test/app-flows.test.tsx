import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/api/client", () => ({
  api: {
    listProjects: vi.fn(async () => [{ id: "arta", name: "arta", desc: "", kind: "existing", stack: "Go",
      docStatus: "ok", coverage: 94, createdAt: "", backlog: 2, topStage: "execute",
      session: { status: "running", phase: "Execute", flow: "feature" }, activity: "x", commit: "y" }]),
    listSpecs: vi.fn(async () => []), listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})), startSession: vi.fn(), deleteSpec: vi.fn(), createSpec: vi.fn(),
  },
  ApiError: class extends Error {},
}));
import App from "../src/App";
describe("app flows", () => {
  it("loads projects from the api on mount", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText(/arta/i).length).toBeGreaterThan(0));
  });
});
