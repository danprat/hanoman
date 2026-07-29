/* SPEC-393 · pane yang bergulir harus BENAR-BENAR bisa digulir.
   SPEC-363 memindahkan tinggi pane Docs/IDE ke rantai flex, tapi memasangnya lewat `style` pada
   div TERLUAR `Card` saja. `Card` selalu menyisipkan satu pembungkus `<div>` di sekitar
   `children` yang `display: block` kecuali prop `fill` dipasang — jadi `flex: 1 1 auto` di pane
   jadi inert, pane tumbuh setinggi isinya, dan `Card` (`overflow: hidden`) memotongnya. Terukur
   di Chrome: pane 11 830 px di dalam kartu 701 px, 11 184 px terpotong, tanpa scroller mana pun.

   Test SPEC-363 lolos sepanjang bug ini karena ia hanya memeriksa style PANE-nya sendiri, yang
   memang tak pernah salah. Yang harus dijaga adalah INDUK-induknya, jadi di sini rantai leluhur
   yang dinaiki. jsdom tak melayout — yang diuji kontrak style tiap mata rantai. */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: {
    getDocs: vi.fn(async () => ({ coverage: 100, tree: [
      { cat: "internal/docs/product", files: ["prd.md"], linked: true, scored: true },
    ] })),
    getDoc: vi.fn(async () => ({ path: "internal/docs/product/prd.md", content: "# prd" })),
    docDownloadUrl: () => "#",
    ideTree: vi.fn(async () => ({ ref: "", files: ["README.md"] })),
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    ideFile: vi.fn(async () => ({ path: "README.md", content: "# hi", binary: false, truncated: false })),
    ideWorkingStatus: vi.fn(async () => ({ branch: "main", staged: [], unstaged: [] })),
    ideFileDownloadUrl: () => "#",
  },
  ApiError: class extends Error {},
}));

import { DocsWorkspace } from "../src/screens/DocsWorkspace";
import { IdeScreen } from "../src/screens/IdeScreen";

beforeEach(() => vi.clearAllMocks());

/* Sebuah pane `overflow: auto` hanya bisa menggulir kalau tingginya dibatasi dari atas. Setiap
   leluhur antara pane dan root layar karena itu harus MENERUSKAN tinggi: menjadi container
   flex/grid (supaya `flex` anaknya berlaku) DAN boleh menyusut di bawah tinggi isinya
   (`min-height: 0`). Satu mata rantai `display: block` sudah cukup memutus semuanya. */
function brokenLinks(pane: HTMLElement, root: HTMLElement): string[] {
  const broken: string[] = [];
  for (let n = pane.parentElement; n; n = n.parentElement) {
    const display = n.style.display;
    const why: string[] = [];
    if (display !== "flex" && display !== "grid") why.push(`display "${display || "block"}"`);
    if (n.style.minHeight !== "0" && n.style.minHeight !== "0px") why.push(`min-height "${n.style.minHeight || "auto"}"`);
    if (why.length) broken.push(`<div style="${n.getAttribute("style") ?? ""}"> → ${why.join(" + ")}`);
    if (n === root) break;
  }
  return broken;
}

const rootOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe("rantai gulir pane tak boleh putus (SPEC-393)", () => {
  it("Docs · SoT — pane dokumen", async () => {
    const { container } = render(<DocsWorkspace projectId="p1" projectName="P1" docStatus="ok" />);
    await waitFor(() => expect(screen.getByTestId("doc-preview-scroll")).toBeInTheDocument());
    expect(brokenLinks(screen.getByTestId("doc-preview-scroll"), rootOf(container))).toEqual([]);
  });

  it("IDE · Explorer — pane berkas (preview, source, diff)", async () => {
    const { container } = render(<IdeScreen projects={[{ id: "p1", name: "P1" }] as never[]}
      projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByText("README.md"));
    await waitFor(() => expect(screen.getByTestId("doc-preview-scroll")).toBeInTheDocument());
    expect(brokenLinks(screen.getByTestId("doc-preview-scroll"), rootOf(container))).toEqual([]);
  });

  it("IDE · Explorer — pane pohon berkas", async () => {
    const { container } = render(<IdeScreen projects={[{ id: "p1", name: "P1" }] as never[]}
      projectId="p1" onProject={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("ide-tree-scroll")).toBeInTheDocument());
    expect(brokenLinks(screen.getByTestId("ide-tree-scroll"), rootOf(container))).toEqual([]);
  });
});
