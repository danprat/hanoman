import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { emojify, gravatarUrl, linkify, mdInline } from "../src/screens/git-graph-render";

describe("git-graph-render (SPEC-233)", () => {
  it("emojify mengganti shortcode", () => {
    expect(emojify(":rocket: rilis")).toContain("🚀");
    expect(emojify("tanpa emoji")).toBe("tanpa emoji");
    expect(emojify(":unknown_code:")).toBe(":unknown_code:");
  });
  it("gravatarUrl = md5(email) 32-hex, case-insensitive", () => {
    expect(gravatarUrl("t@t")).toMatch(/^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{32}/);
    expect(gravatarUrl("T@T")).toBe(gravatarUrl("t@t")); // lowercase + trim
  });
  it("linkify membuat anchor untuk URL & issue", () => {
    render(<div>{linkify("lihat https://ex.com dan #12", "https://gh/acme/app/issues/$1")}</div>);
    const url = screen.getByText("https://ex.com") as HTMLAnchorElement;
    expect(url.getAttribute("href")).toBe("https://ex.com");
    const issue = screen.getByText("#12") as HTMLAnchorElement;
    expect(issue.getAttribute("href")).toBe("https://gh/acme/app/issues/12");
  });
  it("linkify tanpa issuePattern: #12 tetap teks", () => {
    render(<div data-testid="w">{linkify("bug #5", undefined)}</div>);
    expect(screen.getByTestId("w").querySelector("a")).toBeNull();
  });
  it("mdInline render bold/italic/code", () => {
    render(<div data-testid="m">{mdInline("ini **tebal** dan `kode`")}</div>);
    expect(screen.getByTestId("m").querySelector("strong")?.textContent).toBe("tebal");
    expect(screen.getByTestId("m").querySelector("code")?.textContent).toBe("kode");
  });
});
