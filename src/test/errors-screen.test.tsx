import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const { listErrors, getError, escalateError, patchError } = vi.hoisted(() => {
  const GROUP = {
    id: "g1", projectId: "a", type: "TypeError", message: "x is undefined",
    environment: "production", status: "new", count: 4,
    firstSeenAt: "2026-07-20T00:00:00.000Z", lastSeenAt: "2026-07-20T00:00:00.000Z", specId: null,
  };
  const DETAIL = { ...GROUP, sampleStack: "TypeError\n    at handler (/srv/x.js:42:10)", events: [] };
  return {
    listErrors: vi.fn(async (_p?: Record<string, string | undefined>) => ({ items: [GROUP], total: 1, page: 1, pageSize: 20 })),
    getError: vi.fn(async () => DETAIL),
    escalateError: vi.fn(async () => ({ spec: { id: "SPEC-141", projectId: "a" }, alreadyEscalated: false })),
    patchError: vi.fn(async () => ({ id: "g1", status: "resolved" })),
  };
});

vi.mock("../src/api/client", () => ({
  api: { listErrors, getError, escalateError, patchError },
  ApiError: class extends Error {},
}));

import { ErrorsScreen } from "../src/screens/ErrorsScreen";

const projects = [{ id: "a", name: "Alpha" }] as unknown as Parameters<typeof ErrorsScreen>[0]["projects"];

describe("ErrorsScreen (SPEC-249)", () => {
  it("lists groups then opens detail with sample stack on click", async () => {
    render(<ErrorsScreen projects={projects} onEscalated={vi.fn()} onToast={vi.fn()} />);
    expect(await screen.findByText("x is undefined")).toBeInTheDocument();
    fireEvent.click(screen.getByText("x is undefined"));
    expect(await screen.findByText(/at handler/)).toBeInTheDocument();
  });

  it("escalates to backlog and calls onEscalated with the new spec", async () => {
    const onEscalated = vi.fn();
    render(<ErrorsScreen projects={projects} onEscalated={onEscalated} onToast={vi.fn()} />);
    fireEvent.click(await screen.findByText("x is undefined"));
    fireEvent.click(await screen.findByText("Eskalasi ke backlog"));
    await waitFor(() => expect(escalateError).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(onEscalated).toHaveBeenCalledWith({ id: "SPEC-141", projectId: "a" }, false));
  });

  it("environment filter re-queries listErrors with the chosen environment", async () => {
    render(<ErrorsScreen projects={projects} onEscalated={vi.fn()} onToast={vi.fn()} />);
    await screen.findByText("x is undefined");
    const envSelect = screen.getByDisplayValue("Semua environment");
    await act(async () => { fireEvent.change(envSelect, { target: { value: "production" } }); });
    await waitFor(() =>
      expect(listErrors).toHaveBeenCalledWith(expect.objectContaining({ environment: "production" })));
  });
});
