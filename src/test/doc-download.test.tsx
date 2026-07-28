import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Button } from "../src/ds";
import { DocDownload } from "../src/ds/DocDownload";
import { paths } from "@hanoman/shared";

describe('Button as="a"', () => {
  it("merender anchor, bukan button", () => {
    render(<Button as="a" href="/x" download>unduh</Button>);
    const el = screen.getByText("unduh").closest("a");
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("href", "/x");
    expect(el).toHaveAttribute("download");
  });
  it("tetap merender <button> secara default", () => {
    render(<Button>klik</Button>);
    expect(screen.getByRole("button", { name: "klik" })).toBeInTheDocument();
  });
});

describe("paths.download", () => {
  it("menempelkan query ke URL tanpa query", () => {
    expect(paths.download("/api/projects/p1/docs/a/b.md", "pdf"))
      .toBe("/api/projects/p1/docs/a/b.md?download=pdf");
  });
  it("menempelkan query ke URL yang sudah punya query", () => {
    expect(paths.download("/api/projects/p1/file?path=a.md", "md"))
      .toBe("/api/projects/p1/file?path=a.md&download=md");
  });
});

describe("DocDownload", () => {
  it("merender dua anchor unduh dengan href dari href(fmt)", () => {
    render(<DocDownload href={(f) => `/api/x?download=${f}`} />);
    const md = screen.getByRole("link", { name: /unduh \.md/i });
    const pdf = screen.getByRole("link", { name: /unduh \.pdf/i });
    expect(md).toHaveAttribute("href", "/api/x?download=md");
    expect(pdf).toHaveAttribute("href", "/api/x?download=pdf");
    expect(md).toHaveAttribute("download");
  });
  it("tidak merender apa pun saat disabled", () => {
    const { container } = render(<DocDownload href={() => "/x"} disabled />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
