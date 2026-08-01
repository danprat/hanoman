import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentDocCard } from "../src/screens/AgentDocCard";

const MD = "# hanoman — dokumentasi AI Agent\n\n## 0. Apa itu hanoman\n\nOrchestrator.\n";
const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });
const notFound = { ok: false, status: 404, text: async () => "{}" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ok(MD)));
});

describe("AgentDocCard", () => {
  it("menampilkan URL absolut yang bisa disalin agen", () => {
    render(<AgentDocCard />);
    expect(screen.getByText(`${window.location.origin}/api/agent-integration.md`)).toBeTruthy();
  });

  // Kunci "satu sumber": yang dirender di dashboard adalah respons endpoint yang SAMA dengan yang
  // dibaca agen. Kalau komponen ini pernah menyimpan naskahnya sendiri, test ini merah.
  it("tombol Buka merender isi dari endpoint, bukan salinan lokal", async () => {
    render(<AgentDocCard />);
    fireEvent.click(screen.getByRole("button", { name: /buka/i }));
    await waitFor(() => expect(screen.getByText("0. Apa itu hanoman")).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith("/api/agent-integration.md", expect.anything());
  });

  it("endpoint gagal → pesan galat, bukan modal kosong", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notFound));
    render(<AgentDocCard />);
    fireEvent.click(screen.getByRole("button", { name: /buka/i }));
    await waitFor(() => expect(screen.getByText(/gagal memuat/i)).toBeTruthy());
    expect(screen.queryByText("0. Apa itu hanoman")).toBeNull();
  });
});
