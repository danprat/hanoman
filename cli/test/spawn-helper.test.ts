import { describe, it, expect } from "vitest";
import { spawnHelperPaths, ensureSpawnHelpersExecutable } from "../src/commands/start";

// SPEC-403 · terminal sesi BLANK di `npm i -g hanoman`. Sesi tmux-nya hidup dan berisi output,
// tapi jembatan node-pty gagal spawn (`posix_spawnp failed`) karena `spawn-helper` terpasang
// tanpa bit executable. Bukan bug kita: tarball node-pty@1.1.0 memang mengirim SEMUA
// `prebuilds/*/spawn-helper` dengan mode 0644 (`tar tvf` → `-rw-r--r--`). pnpm memulihkan bit
// itu, npm tidak → dev sehat, instalasi global mati senyap.
describe("spawnHelperPaths", () => {
  const tree: Record<string, string[]> = {
    "/pty/prebuilds": ["darwin-arm64", "darwin-x64", "win32-x64"],
    "/pty/prebuilds/darwin-arm64": ["pty.node", "spawn-helper"],
    "/pty/prebuilds/darwin-x64": ["pty.node", "spawn-helper"],
    "/pty/prebuilds/win32-x64": ["pty.node", "conpty.node"],   // windows tak punya helper
    "/pty/build/Release": ["pty.node", "spawn-helper"],
  };
  const listDir = (d: string): string[] => tree[d] ?? [];
  const exists = (p: string): boolean =>
    Object.entries(tree).some(([dir, names]) => names.some((n) => `${dir}/${n}` === p));

  it("mengumpulkan helper dari semua prebuild DAN dari build lokal node-gyp", () => {
    expect(spawnHelperPaths("/pty", listDir, exists).sort()).toEqual([
      "/pty/build/Release/spawn-helper",
      "/pty/prebuilds/darwin-arm64/spawn-helper",
      "/pty/prebuilds/darwin-x64/spawn-helper",
    ]);
  });

  it("direktori tanpa spawn-helper tidak dikarang jadi kandidat", () => {
    expect(spawnHelperPaths("/pty", listDir, exists)).not.toContain("/pty/prebuilds/win32-x64/spawn-helper");
  });

  it("pohon yang sama sekali bukan node-pty → daftar kosong, bukan lempar", () => {
    expect(spawnHelperPaths("/kosong", () => [], () => false)).toEqual([]);
  });
});

describe("ensureSpawnHelpersExecutable", () => {
  it("hanya chmod berkas yang belum executable, dan melaporkan yang diperbaiki", () => {
    const modes: Record<string, number> = { "/a/spawn-helper": 0o644, "/b/spawn-helper": 0o755 };
    const fixed = ensureSpawnHelpersExecutable(Object.keys(modes), {
      mode: (p) => modes[p]!,
      chmod: (p, m) => { modes[p] = m; },
    });
    expect(fixed).toEqual(["/a/spawn-helper"]);
    expect(modes["/a/spawn-helper"]! & 0o111).toBe(0o111);
    expect(modes["/b/spawn-helper"]).toBe(0o755);   // tak disentuh
  });

  it("mempertahankan bit baca/tulis yang sudah ada, hanya MENAMBAH bit exec", () => {
    const modes: Record<string, number> = { "/a/spawn-helper": 0o640 };
    ensureSpawnHelpersExecutable(["/a/spawn-helper"], {
      mode: (p) => modes[p]!,
      chmod: (p, m) => { modes[p] = m; },
    });
    expect(modes["/a/spawn-helper"]).toBe(0o751);
  });

  // Instalasi global bisa dimiliki root (`sudo npm i -g`) sementara hanoman dijalankan sebagai
  // pengguna biasa: chmod melempar EPERM. Itu bukan alasan menolak start — server tetap jalan,
  // hanya terminalnya yang cacat, dan pemanggil yang memutuskan cara memberi tahu.
  it("chmod gagal → tidak melempar, berkas itu tak diklaim sudah diperbaiki", () => {
    const fixed = ensureSpawnHelpersExecutable(["/a/spawn-helper", "/b/spawn-helper"], {
      mode: () => 0o644,
      chmod: (p) => { if (p === "/a/spawn-helper") throw Object.assign(new Error("EPERM"), { code: "EPERM" }); },
    });
    expect(fixed).toEqual(["/b/spawn-helper"]);
  });
});
