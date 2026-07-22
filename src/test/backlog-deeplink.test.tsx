import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-9", projectId: "p", title: "Judul backlog tertaut", source: "brief", stage: "executing",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null, ...over }) as Spec;

describe("SPEC-293 · BacklogScreen initialDetailId (deep-link)", () => {
  it("membuka SpecDetail untuk id awal", async () => {
    render(
      <BacklogScreen backlog={[spec()]} projects={[{ id: "p", name: "P" } as any]}
        projectFilter="all" onProjectFilter={() => {}} initialDetailId="SPEC-9" />,
    );
    // Modal SpecDetail menampilkan judul + eyebrow "SPEC-9 · p"
    expect(await screen.findByText(/SPEC-9 · p/)).toBeTruthy();
    expect(screen.getAllByText("Judul backlog tertaut").length).toBeGreaterThan(0);
  });
});
