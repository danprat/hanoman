import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { IdeScreen } from "../src/screens/IdeScreen";
import { api, ApiError } from "../src/api/client";

const projects = [{ id: "p1", name: "p1", repoDir: "/r", kind: "existing" }] as any;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "ideTree").mockResolvedValue({ ref: "", files: ["src/a.ts", "README.md"] });
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main", "dev"], remotes: ["main"] });
  vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# hi", binary: false, truncated: false });
});

describe("IdeScreen Explorer", () => {
  it("menampilkan pohon file dari ideTree", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    expect(await screen.findByText("README.md")).toBeInTheDocument();
  });
  it("klik file memuat isinya", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    await waitFor(() => expect(api.ideFile).toHaveBeenCalledWith("p1", "README.md", ""));
  });
  it("mengelompokkan file per folder, folder collapse default", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    // folder src/ tampil sebagai header…
    expect(await screen.findByText("src/")).toBeInTheDocument();
    // …tapi isinya (a.ts) tersembunyi sampai di-expand
    expect(screen.queryByText("a.ts")).toBeNull();
    // buka folder → a.ts muncul
    fireEvent.click(screen.getByText("src/"));
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
  });
  it("tombol Checkout memanggil ideGit", async () => {
    vi.spyOn(api, "ideGit").mockResolvedValue({ ok: true, stdout: "", stderr: "", current: "dev" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await screen.findByText("README.md");
    // pilih ref "dev" agar Checkout aktif
    fireEvent.change(screen.getByDisplayValue("· working tree ·"), { target: { value: "dev" } });
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    await waitFor(() => expect(api.ideGit).toHaveBeenCalledWith("p1", { op: "checkout", ref: "dev" }));
  });
  it("checkout 409 memunculkan dialog Paksa", async () => {
    vi.spyOn(api, "ideGit").mockRejectedValueOnce(new ApiError(409, "sesi aktif"));
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await screen.findByText("README.md");
    fireEvent.change(screen.getByDisplayValue("· working tree ·"), { target: { value: "dev" } });
    fireEvent.click(screen.getByRole("button", { name: /checkout/i }));
    expect(await screen.findByRole("button", { name: /paksa/i })).toBeInTheDocument();
  });
});

// SPEC-229 · merge via git graph: konflik → pindah Terminal (sesi claude); bersih → toast; error → toast.
describe("IdeScreen merge git graph", () => {
  beforeEach(() => {
    vi.spyOn(api, "ideGraph").mockResolvedValue({ current: "main", commits: [
      { sha: "aaaaaaa", parents: [], author: "t", at: new Date(0).toISOString(), subject: "c1", refs: ["origin/feat"], tags: [] },
    ] });
  });
  const openMergeMenu = async () => {
    fireEvent.click(await screen.findByRole("tab", { name: /git graph/i }));
    fireEvent.contextMenu(await screen.findByText("c1"));
    fireEvent.click(await screen.findByText("Merge (fast-forward bila bisa)"));
  };

  it("konflik → onGotoTerminal(sessionId) + toast warn", async () => {
    const onGoto = vi.fn(); const onToast = vi.fn();
    vi.spyOn(api, "ideGitMerge").mockResolvedValue({ status: "conflict", sessionId: "merge-main" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} onToast={onToast} onGotoTerminal={onGoto} />);
    await openMergeMenu();
    await waitFor(() => expect(api.ideGitMerge).toHaveBeenCalledWith("p1", { source: "aaaaaaa" }));
    await waitFor(() => expect(onGoto).toHaveBeenCalledWith("merge-main"));
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("konflik"), "warn", "git-merge");
  });

  it("bersih → toast ok, tanpa navigasi", async () => {
    const onGoto = vi.fn(); const onToast = vi.fn();
    vi.spyOn(api, "ideGitMerge").mockResolvedValue({ status: "clean", detail: "lokal main (ff) → abcdef0" });
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} onToast={onToast} onGotoTerminal={onGoto} />);
    await openMergeMenu();
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("merge berhasil"), "ok", "git-merge"));
    expect(onGoto).not.toHaveBeenCalled();
  });

  it("error 409 → toast err, tak melempar ke luar", async () => {
    const onToast = vi.fn();
    vi.spyOn(api, "ideGitMerge").mockRejectedValue(new ApiError(409, "tak bisa ff"));
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} onToast={onToast} onGotoTerminal={vi.fn()} />);
    await openMergeMenu();
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("gagal merge"), "err", "x-circle"));
  });
});
