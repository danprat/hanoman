import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MultiSelect } from "../src/ds";

// SPEC-484 · ADR-0101 · opsinya ber-`role="option"` justru supaya bisa diuji lewat getByRole —
// `Checkbox`/`Switch` DS bukan <input> dan mengklik labelnya no-op, yang membuat test "lulus"
// tanpa terjadi apa-apa (pelajaran SPEC-299/360/447).

const options = [
  { value: "Read", label: "Read" },
  { value: "Bash", label: "Bash" },
  { value: "mcp__context7__*", label: "context7 — semua tool", group: "MCP" },
];

const open = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));

describe("MultiSelect", () => {
  it("tertutup secara default; membuka menampilkan opsi ber-role option", () => {
    render(<MultiSelect aria-label="Tools" options={options} value={[]} onChange={() => {}} />);
    expect(screen.queryByRole("option")).toBeNull();
    open("Tools");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("pencarian menyaring opsi", () => {
    render(<MultiSelect aria-label="Tools" options={options} value={[]} onChange={() => {}} />);
    open("Tools");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "context" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").textContent).toContain("context7");
  });

  it("memilih opsi memanggil onChange dengan nilai yang bertambah", () => {
    const onChange = vi.fn();
    render(<MultiSelect aria-label="Tools" options={options} value={["Read"]} onChange={onChange} />);
    open("Tools");
    fireEvent.click(screen.getByRole("option", { name: /Bash/ }));
    expect(onChange).toHaveBeenCalledWith(["Read", "Bash"]);
  });

  it("memilih ulang opsi terpilih akan MENCABUTNYA", () => {
    const onChange = vi.fn();
    render(<MultiSelect aria-label="Tools" options={options} value={["Read"]} onChange={onChange} />);
    open("Tools");
    fireEvent.click(screen.getByRole("option", { name: /Read/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("chip menampilkan yang terpilih; tombol × mencabutnya", () => {
    const onChange = vi.fn();
    render(<MultiSelect aria-label="Tools" options={options} value={["Read", "Bash"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus Read" }));
    expect(onChange).toHaveBeenCalledWith(["Bash"]);
  });

  it("nilai di luar katalog dirender sebagai chip BERTANDA, bukan hilang", () => {
    render(<MultiSelect aria-label="Tools" options={options} value={["Read", "ToolHilang"]}
      invalidValues={["ToolHilang"]} onChange={() => {}} />);
    const chip = screen.getByTestId("chip-ToolHilang");
    expect(chip.textContent).toContain("ToolHilang");
    expect(chip.getAttribute("title")).toMatch(/tak ada di katalog/i);
  });

  it("pencarian tanpa hasil menampilkan emptyText", () => {
    render(<MultiSelect aria-label="Tools" options={options} value={[]} onChange={() => {}}
      emptyText="Tak ada yang cocok." />);
    open("Tools");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("Tak ada yang cocok.")).toBeTruthy();
  });
});
