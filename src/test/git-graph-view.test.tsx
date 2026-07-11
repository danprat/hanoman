import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { GitGraph } from "../src/screens/GitGraph";
import { api } from "../src/api/client";

const commits = [
  { sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["main"] },
  { sha: "bbbb222", parents: [], author: "t", at: "2026-01-01T00:00:00Z", subject: "pertama", refs: [] },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "ideGraph").mockResolvedValue({ commits, current: "main" });
  vi.spyOn(api, "ideCommit").mockResolvedValue({ sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "",
    subject: "kedua", body: "", changed: [{ path: "a.ts", add: 1, del: 0, status: "M", binary: false }] });
});

describe("GitGraph", () => {
  it("menggambar baris commit dari ideGraph", async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onOpenFile={vi.fn()} />);
    expect(await screen.findByText("kedua")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument(); // chip ref
  });
  it("klik commit memuat detail file berubah", async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByText("kedua"));
    await waitFor(() => expect(api.ideCommit).toHaveBeenCalledWith("p1", "aaaa111"));
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
  });
  it("context-menu Checkout memanggil onRunGit", async () => {
    const onRunGit = vi.fn().mockResolvedValue({});
    render(<GitGraph projectId="p1" onRunGit={onRunGit} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText(/checkout/i));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "checkout", ref: "aaaa111" }));
  });
});
