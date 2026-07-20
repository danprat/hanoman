import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { GitGraph } from "../src/screens/GitGraph";
import { api } from "../src/api/client";

const commits = [
  { sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["main"], tags: [] },
  { sha: "bbbb222", parents: [], author: "t", at: "2026-01-01T00:00:00Z", subject: "pertama", refs: [], tags: [] },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "ideGraph").mockResolvedValue({ commits, current: "main" });
  vi.spyOn(api, "ideCommit").mockResolvedValue({ sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "",
    subject: "kedua", body: "", changed: [{ path: "a.ts", add: 1, del: 0, status: "M", binary: false }] });
});

describe("GitGraph", () => {
  it("menggambar baris commit dari ideGraph", async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    expect(await screen.findByText("kedua")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument(); // chip ref
  });
  it("klik commit memuat detail file berubah", async () => {
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByText("kedua"));
    await waitFor(() => expect(api.ideCommit).toHaveBeenCalledWith("p1", "aaaa111"));
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
  });
  it("context-menu Checkout memanggil onRunGit", async () => {
    const onRunGit = vi.fn().mockResolvedValue({});
    render(<GitGraph projectId="p1" onRunGit={onRunGit} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText(/checkout/i));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "checkout", ref: "aaaa111" }));
  });

  // SPEC-206 · hapus branch local dan/atau origin lewat klik-kanan
  it("branch local+origin: tawarkan hapus local+origin, local, dan origin", async () => {
    const onRunGit = vi.fn().mockResolvedValue({});
    vi.spyOn(api, "ideGraph").mockResolvedValue({
      commits: [{ sha: "aaaa111", parents: [], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["feat", "origin/feat"], tags: [] }],
      current: "main",
    });
    render(<GitGraph projectId="p1" onRunGit={onRunGit} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));

    fireEvent.click(await screen.findByText("Hapus feat (local + origin)"));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "delete-branch", name: "feat", remote: true }));

    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("Hapus feat (local)"));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "delete-branch", name: "feat" }));

    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("Hapus origin/feat"));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "delete-branch", name: "feat", local: false, remote: true }));
  });

  it("ref origin saja (tanpa local): hanya tawarkan hapus origin", async () => {
    const onRunGit = vi.fn().mockResolvedValue({});
    vi.spyOn(api, "ideGraph").mockResolvedValue({
      commits: [{ sha: "aaaa111", parents: [], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["origin/gone"], tags: [] }],
      current: "main",
    });
    render(<GitGraph projectId="p1" onRunGit={onRunGit} onMerge={vi.fn()} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    expect(screen.queryByText(/Hapus gone \(local/)).toBeNull();
    fireEvent.click(await screen.findByText("Hapus origin/gone"));
    await waitFor(() => expect(onRunGit).toHaveBeenCalledWith({ op: "delete-branch", name: "gone", local: false, remote: true }));
  });

  // SPEC-229 · aksi merge pindah dari onRunGit ke onMerge (jalur worktree isolasi + sesi claude).
  it("merge commit (termasuk origin) memanggil onMerge dengan sha, bukan onRunGit", async () => {
    const onRunGit = vi.fn().mockResolvedValue({}), onMerge = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(api, "ideGraph").mockResolvedValue({
      commits: [{ sha: "aaaa111", parents: [], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["origin/feat"], tags: [] }],
      current: "main",
    });
    render(<GitGraph projectId="p1" onRunGit={onRunGit} onMerge={onMerge} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("Merge (fast-forward bila bisa)"));
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith("aaaa111", undefined));
    expect(onRunGit).not.toHaveBeenCalled();
  });

  it("merge --no-ff & 'Merge <branch> lalu hapus' meneruskan opsi ke onMerge", async () => {
    const onMerge = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(api, "ideGraph").mockResolvedValue({
      commits: [{ sha: "aaaa111", parents: [], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["feat"], tags: [] }],
      current: "main",
    });
    render(<GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={onMerge} onRebase={vi.fn()} onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />);
    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText("Merge tanpa fast-forward"));
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith("aaaa111", { ff: "no-ff" }));

    fireEvent.contextMenu(await screen.findByText("kedua"));
    fireEvent.click(await screen.findByText(/Merge feat lalu hapus/));
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith("feat", { deleteBranch: "feat" }));
  });
});
