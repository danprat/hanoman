import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({
  api: { getSettings: vi.fn(), listUsers: vi.fn(), putSettings: vi.fn() },
  ApiError: class extends Error { status = 0 },
}));

beforeEach(() => {
  (api.getSettings as any).mockResolvedValue({ model: "claude-opus-4-8", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true });
  (api.listUsers as any).mockResolvedValue([{ id: "u1", email: "a@b.c", createdAt: new Date().toISOString() }]);
});

const me = { id: "u1", email: "a@b.c" } as any;

describe("SettingsScreen sidebar", () => {
  it("mulai di Akun (form ganti password) lalu pindah tab lewat sidebar", async () => {
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    // default tab = Akun
    expect(await screen.findByText("Ganti password")).toBeInTheDocument();
    // pindah ke Model sesi → kartu model muncul, form password hilang
    fireEvent.click(screen.getByText("Model sesi"));
    await waitFor(() => expect(screen.queryByText("Ganti password")).toBeNull());
    expect(screen.getByText("Effort")).toBeInTheDocument();
    // pindah ke Umum → toggle full-auto
    fireEvent.click(screen.getByText("Umum"));
    expect(await screen.findByText("Full-auto sebagai default")).toBeInTheDocument();
    expect(screen.getByText("Reset ke default")).toBeInTheDocument();
  });
});
