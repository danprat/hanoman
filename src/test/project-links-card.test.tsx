import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ProjectLinksCard } from "../src/screens/ProjectLinksCard";
import { api } from "../src/api/client";
import type { ProjectVM } from "../src/screens/types";

const p = { id: "web", name: "Web" } as ProjectVM;
const others = [{ id: "api", name: "API" }, { id: "sdk", name: "SDK" }];
const link = {
  id: "l1", fromProjectId: "web", toProjectId: "api", kind: "api",
  note: "web memanggil /api/orders", direction: "keluar" as const, other: { id: "api", name: "API" },
};

beforeEach(() => vi.restoreAllMocks());

describe("ProjectLinksCard", () => {
  it("menampilkan relasi yang ada dengan arah dan catatannya", async () => {
    vi.spyOn(api, "listProjectLinks").mockResolvedValue({ links: [link] });
    render(<ProjectLinksCard p={p} others={others} onToast={() => {}} />);
    expect(await screen.findByText(/Web bergantung pada API/)).toBeTruthy();
    expect(screen.getByText(/web memanggil \/api\/orders/)).toBeTruthy();
  });

  it("menambah relasi lalu memuat ulang daftar", async () => {
    const list = vi.spyOn(api, "listProjectLinks")
      .mockResolvedValueOnce({ links: [] })
      .mockResolvedValueOnce({ links: [{ ...link, note: "" }] });
    const create = vi.spyOn(api, "createProjectLink").mockResolvedValue({ ...link, note: "" });
    render(<ProjectLinksCard p={p} others={others} onToast={() => {}} />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Tambah relasi"));
    await waitFor(() => expect(create).toHaveBeenCalledWith("web", expect.objectContaining({ to: "api", kind: "api" })));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("tombol audit lintas mati saat belum ada relasi", async () => {
    vi.spyOn(api, "listProjectLinks").mockResolvedValue({ links: [] });
    const onCrossAudit = vi.fn();
    render(<ProjectLinksCard p={p} others={others} onToast={() => {}} onCrossAudit={onCrossAudit} />);
    const btn = await screen.findByText("Audit lintas project");
    fireEvent.click(btn.closest("button")!);
    expect(onCrossAudit).not.toHaveBeenCalled();
  });

  it("tombol audit lintas hidup begitu ada relasi", async () => {
    vi.spyOn(api, "listProjectLinks").mockResolvedValue({ links: [link] });
    const onCrossAudit = vi.fn();
    render(<ProjectLinksCard p={p} others={others} onToast={() => {}} onCrossAudit={onCrossAudit} />);
    await screen.findByText(/Web bergantung pada API/);
    fireEvent.click(screen.getByText("Audit lintas project").closest("button")!);
    expect(onCrossAudit).toHaveBeenCalled();
  });
});
