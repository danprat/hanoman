import { describe, it, expect } from "vitest";
import { coverageOf, docStatusFor, linkedSetFrom, resolveLink } from "../src/index";
describe("coverage (shared)", () => {
  it("half linked -> 50", () =>
    expect(coverageOf([{category:"a",linked:true},{category:"b",linked:false}])).toBe(50));
  it("status thresholds", () => {
    expect(docStatusFor(94)).toBe("ok"); expect(docStatusFor(75)).toBe("drift"); expect(docStatusFor(38)).toBe("broken"); });
});

describe("resolveLink", () => {
  it("resolves ./ and ../ against the source file's dir", () => {
    expect(resolveLink("a/b/c.md", "../d.md")).toBe("a/d.md");
    expect(resolveLink("a/b.md", "./e.md")).toBe("a/e.md");
    expect(resolveLink("README.md", "internal/docs/x.md")).toBe("internal/docs/x.md");
  });
  // SPEC-197 · link bertitel & absolut-dari-root sebelumnya salah resolve → under-count coverage.
  it("strips a link title and handles root-absolute targets", () => {
    expect(resolveLink("internal/docs/a.md", './b.md "judul"')).toBe("internal/docs/b.md");
    expect(resolveLink("internal/docs/a.md", "/internal/docs/c.md")).toBe("internal/docs/c.md");
    expect(resolveLink("internal/docs/sub/a.md", "../b.md")).toBe("internal/docs/b.md");
  });
});

describe("linkedSetFrom", () => {
  const docs = ["i/README.md", "i/product/prd.md", "i/orphan.md"];
  const read = (rel: string): string | null => (({
    "i/README.md": "- [PRD](product/prd.md)\n- [ext](https://x.com)\n- [anchor](#top)",
    "i/product/prd.md": "# prd",
    "i/orphan.md": "# orphan",
  }) as Record<string, string>)[rel] ?? null;

  it("reaches linked docs, drops orphans and external links", () => {
    const s = linkedSetFrom("i/README.md", docs, read);
    expect(s.has("i/product/prd.md")).toBe(true);
    expect(s.has("i/orphan.md")).toBe(false);
  });

  it("follows links through intermediate docs (transitive)", () => {
    const d = ["i/README.md", "i/a.md", "i/b.md"];
    const r = (rel: string) => (({ "i/README.md": "[a](a.md)", "i/a.md": "[b](b.md)", "i/b.md": "end" }) as Record<string, string>)[rel] ?? null;
    expect(linkedSetFrom("i/README.md", d, r).has("i/b.md")).toBe(true);
  });
});
