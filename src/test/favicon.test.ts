// @vitest-environment node
// Berkas ini butuh node:fs/node:url asli; environment "jsdom" default proyek
// (src/vite.config.ts) membuat Vite meng-externalize keduanya jadi stub kosong.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("favicon (SPEC-147)", () => {
  it("index.html menautkan favicon SVG", () => {
    expect(read("../index.html")).toContain(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
    );
  });

  it("favicon.svg adalah tile brass ber-radius 24% dengan mark putih", () => {
    const svg = read("../public/favicon.svg");
    expect(svg).toContain('viewBox="0 0 128 128"'); // grid mark
    expect(svg).toContain('rx="30.72"');            // 128 × 0.24
    expect(svg).toContain('fill="#b8863b"');        // --brass-500
    expect(svg).toContain('fill="#fff"');           // mark putih
  });

  // SVG adalah XML: komentar ber-'--' menggagalkan parser yang ketat.
  it("favicon.svg tidak punya double-hyphen di dalam komentar", () => {
    const svg = read("../public/favicon.svg");
    for (const c of svg.match(/<!--[\s\S]*?-->/g) ?? []) {
      expect(c.slice(4, -3)).not.toContain("--");
    }
  });
});
