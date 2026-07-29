/* SPEC-385 · DocPreviewModal — pratinjau `.md` terender sebagai AKSI dari permukaan
   berorientasi diff/kode. Test menuntut markdown BENAR-BENAR terparse (heading, bukan
   sekadar teks mentah) supaya tak lulus palsu saat renderer tak terpasang. */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DocPreviewModal, isMarkdownPath } from "../src/ds";

describe("isMarkdownPath", () => {
  it("mengenali .md tanpa peduli besar-kecil huruf", () => {
    expect(isMarkdownPath("docs/a.md")).toBe(true);
    expect(isMarkdownPath("README.MD")).toBe(true);
  });
  it("menolak yang bukan .md", () => {
    expect(isMarkdownPath("src/a.ts")).toBe(false);
    expect(isMarkdownPath("a.md.ts")).toBe(false);
    expect(isMarkdownPath("")).toBe(false);
  });
});

describe("DocPreviewModal", () => {
  it("merender markdown (bukan teks mentah) dan memakai basename sebagai judul", () => {
    render(<DocPreviewModal path="internal/docs/product/prd.md"
      text={"# Judul\n\nisi paragraf"} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Judul" })).toBeInTheDocument();
    expect(screen.getByText("prd.md")).toBeInTheDocument();
    expect(screen.queryByText("# Judul")).toBeNull();
  });

  it("eyebrow default = path penuh, bisa ditimpa", () => {
    const { unmount } = render(<DocPreviewModal path="a/b.md" text="# x" onClose={() => {}} />);
    expect(screen.getByText("a/b.md")).toBeInTheDocument();
    unmount();
    render(<DocPreviewModal path="a/b.md" text="# x" eyebrow="SPEC-385" onClose={() => {}} />);
    expect(screen.getByText("SPEC-385")).toBeInTheDocument();
  });

  it("tanpa prop download tak ada tombol unduh; dengan download ada .md & .pdf (ADR-0078)", () => {
    const { unmount } = render(<DocPreviewModal path="a/b.md" text="# x" onClose={() => {}} />);
    expect(screen.queryByRole("link", { name: /unduh \.md/i })).toBeNull();
    unmount();
    render(<DocPreviewModal path="a/b.md" text="# x" onClose={() => {}}
      download={(f) => `/api/x?download=${f}`} />);
    expect(screen.getByRole("link", { name: /unduh \.md/i })).toHaveAttribute("href", "/api/x?download=md");
    expect(screen.getByRole("link", { name: /unduh \.pdf/i })).toHaveAttribute("href", "/api/x?download=pdf");
  });

  it("berkas kosong memberi keadaan kosong, bukan pane hampa", () => {
    render(<DocPreviewModal path="a/b.md" text="" onClose={() => {}} />);
    expect(screen.getByText(/berkas kosong/i)).toBeInTheDocument();
  });

  it("Escape & tombol tutup memanggil onClose", () => {
    const onClose = vi.fn();
    render(<DocPreviewModal path="a/b.md" text="# x" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Tutup"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("pane baca tak memasang tinggi tetap px/vh (kontrak SPEC-363)", () => {
    render(<DocPreviewModal path="a/b.md" text="# x" onClose={() => {}} />);
    const pane = screen.getByTestId("doc-preview-scroll");
    for (const prop of ["height", "maxHeight", "minHeight"]) {
      const v = pane.style.getPropertyValue(prop);
      expect(v === "" || v === "0px" || v === "0").toBe(true);
    }
    expect(pane.style.overflow).toBe("auto");
  });
});
