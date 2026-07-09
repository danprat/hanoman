import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { StateBlock } from "../src/ds";

describe("StateBlock", () => {
  it("loading marks itself busy and has no action", () => {
    render(<StateBlock kind="loading" title="Memuat…" />);
    expect(screen.getByText("Memuat…").closest("[aria-busy]")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("error announces itself and retries", () => {
    const retry = vi.fn();
    render(<StateBlock kind="error" title="Gagal" action={retry} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    screen.getByText("Coba lagi").click();
    expect(retry).toHaveBeenCalled();
  });

  it("empty shows hint + call to action, not an alert", () => {
    render(<StateBlock kind="empty" title="Kosong" hint="Tambah dulu" action={() => {}} actionLabel="Buat" />);
    expect(screen.getByText("Tambah dulu")).toBeInTheDocument();
    expect(screen.getByText("Buat")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
