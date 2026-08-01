import { describe, it, expect } from "vitest";
import { pickGuideFile, AGENT_DOC_REL } from "../src/guide-file";

// `exists` disuntik supaya test tak menyentuh filesystem sama sekali (pola web-dir.test.ts).
const only = (...paths: string[]) => (p: string) => paths.includes(p);

describe("pickGuideFile", () => {
  it("layout paket npm: <pkg>/dist → <pkg>/docs/agent-integration.md", () => {
    const hit = `/usr/lib/node_modules/hanoman/${AGENT_DOC_REL}`;
    expect(pickGuideFile("/usr/lib/node_modules/hanoman/dist", {}, only(hit))).toBe(hit);
  });

  it("layout checkout terbangun: <repo>/server/dist → <repo>/docs/agent-integration.md", () => {
    const hit = `/repo/${AGENT_DOC_REL}`;
    expect(pickGuideFile("/repo/server/dist", {}, only(hit))).toBe(hit);
  });

  // tsx menjalankan sumbernya langsung; `server/src` sedalam `server/dist`, jadi satu kandidat
  // yang sama melayani dev DAN build. Kalau invarian ini pecah, dev diam-diam kehilangan dokumen.
  it("layout checkout dev (tsx): <repo>/server/src → <repo>/docs/agent-integration.md", () => {
    const hit = `/repo/${AGENT_DOC_REL}`;
    expect(pickGuideFile("/repo/server/src", {}, only(hit))).toBe(hit);
  });

  it("tak ketemu di mana pun → null (bukan melempar)", () => {
    expect(pickGuideFile("/repo/server/dist", {}, () => false)).toBeNull();
  });

  it("HANOMAN_AGENT_DOC menang atas kedua kandidat", () => {
    const forced = "/tmp/panduan.md";
    expect(pickGuideFile("/repo/server/dist", { HANOMAN_AGENT_DOC: forced }, only(forced, `/repo/${AGENT_DOC_REL}`)))
      .toBe(forced);
  });

  // Cermin HANOMAN_WEB_DIR: "dokumen hilang tanpa pesan" mahal didiagnosis, jadi override yang
  // salah gagal KERAS, bukan diam-diam jatuh ke kandidat.
  it("HANOMAN_AGENT_DOC di-set tapi tak ada → melempar", () => {
    expect(() => pickGuideFile("/repo/server/dist", { HANOMAN_AGENT_DOC: "/tmp/hilang.md" }, () => false))
      .toThrow(/HANOMAN_AGENT_DOC/);
  });

  it("override kosong/spasi diabaikan", () => {
    const hit = `/repo/${AGENT_DOC_REL}`;
    expect(pickGuideFile("/repo/server/dist", { HANOMAN_AGENT_DOC: "  " }, only(hit))).toBe(hit);
  });
});
