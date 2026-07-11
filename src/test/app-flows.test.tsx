import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/api/client", () => ({
  api: {
    authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "a@b.co", createdAt: "" } })),
    listProjects: vi.fn(async () => [{ id: "arta", name: "arta", desc: "", kind: "existing", stack: "Go",
      docStatus: "ok", coverage: 94, createdAt: "", backlog: 2, topStage: "execute",
      session: { status: "running", phase: "Execute", flow: "feature" }, activity: "x", commit: "y" }]),
    listSpecs: vi.fn(async () => []), listTerminals: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})), startSession: vi.fn(), deleteSpec: vi.fn(), createSpec: vi.fn(),
    listNotifications: vi.fn(async () => ({ items: [], unread: 0 })), // SPEC-180 · provider poll
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
