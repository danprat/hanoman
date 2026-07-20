import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { rotateIngestKey, revokeIngestKey } = vi.hoisted(() => ({
  rotateIngestKey: vi.fn(async () => ({ enabled: true, prefix: "hnm_ing_abc123", key: "hnm_ing_abc123def", dsnUrl: "http://h/api/ingest/a?key=hnm_ing_abc123def" })),
  revokeIngestKey: vi.fn(async () => undefined),
}));
vi.mock("../src/api/client", () => ({
  api: { rotateIngestKey, revokeIngestKey },
  ApiError: class extends Error {},
}));

import { ProjectDetailScreen } from "../src/screens/ProjectDetailScreen";

const base = {
  id: "a", name: "Alpha", desc: "d", kind: "existing", repoDir: "/r", binding: null, gitRemote: null,
  stack: "ts", docStatus: "ok", coverage: 100, createdAt: "2026-07-10T00:00:00.000Z",
  backlog: 0, topStage: "spec", activity: "idle", commit: "—",
  session: { status: "idle", phase: null, flow: null },
} as const;
const vm = (over: Record<string, unknown>) => ({ ...base, ...over }) as unknown as Parameters<typeof ProjectDetailScreen>[0]["p"];

const noop = vi.fn();
const props = { onEdit: noop, onGotoDocs: noop, onGotoTerminal: noop, onGotoBacklog: noop, onDelete: noop, onToast: noop };

beforeEach(() => { rotateIngestKey.mockClear(); revokeIngestKey.mockClear(); });

describe("DSN management (SPEC-249)", () => {
  it("project without monitoring shows Generate; clicking reveals the DSN once", async () => {
    render(<ProjectDetailScreen p={vm({ monitoringEnabled: false, ingestKeyPrefix: null })} {...props} />);
    fireEvent.click(screen.getByText("Generate DSN"));
    await waitFor(() => expect(rotateIngestKey).toHaveBeenCalledWith("a"));
    expect(await screen.findByText(/api\/ingest\/a\?key=/)).toBeInTheDocument();
    expect(screen.getByText("Salin")).toBeInTheDocument();
  });

  it("project with monitoring shows prefix + Rotate/Revoke", () => {
    render(<ProjectDetailScreen p={vm({ monitoringEnabled: true, ingestKeyPrefix: "hnm_ing_zzz" })} {...props} />);
    expect(screen.getByText(/hnm_ing_zzz/)).toBeInTheDocument();
    expect(screen.getByText("Rotate")).toBeInTheDocument();
    expect(screen.getByText("Revoke")).toBeInTheDocument();
  });

  it("Revoke calls the API after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProjectDetailScreen p={vm({ monitoringEnabled: true, ingestKeyPrefix: "hnm_ing_zzz" })} {...props} />);
    fireEvent.click(screen.getByText("Revoke"));
    await waitFor(() => expect(revokeIngestKey).toHaveBeenCalledWith("a"));
  });
});
