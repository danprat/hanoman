import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { markDeciding, clearDeciding, isDeciding, decidingIds, __resetDeciding } from "../src/services/lead/deciding";

// SPEC-409 · ADR-0091 · AC-3 · penanda "sedang diputuskan".
//
// Kenapa ini punya test sendiri: bentuk sesi yang sedang DILAYANI lead identik dengan sesi yang
// MANDEK menunggu manusia — diam, marker keputusan terisi. Penanda inilah satu-satunya pembedanya,
// dan ia harus bersih setiap kali `decide()` selesai (termasuk saat lead gagal), kalau tidak
// operator melihat "sedang diputuskan" selamanya pada sesi yang tak lagi dilayani siapa pun.

beforeEach(__resetDeciding);
afterEach(__resetDeciding);

describe("penanda sedang-diputuskan", () => {
  it("menyala lalu padam", () => {
    expect(isDeciding("s1")).toBe(false);
    markDeciding("s1");
    expect(isDeciding("s1")).toBe(true);
    expect(decidingIds()).toEqual(["s1"]);
    clearDeciding("s1");
    expect(isDeciding("s1")).toBe(false);
    expect(decidingIds()).toEqual([]);
  });
  it("menandai beberapa sesi sekaligus tanpa saling menimpa", () => {
    markDeciding("s1"); markDeciding("s2");
    clearDeciding("s1");
    expect(decidingIds()).toEqual(["s2"]);
  });
  it("membersihkan sesi yang sama dua kali bukan error", () => {
    markDeciding("s1");
    clearDeciding("s1"); clearDeciding("s1");
    expect(decidingIds()).toEqual([]);
  });
});

// Penghiasan grup siar `sessions` di services/events.ts sengaja TIDAK diuji di sini: ia satu
// ekspresi di atas `listSessions()`, jadi mengamatinya menuntut sesi tmux nyata — dan menulis
// ulang ekspresinya atas daftar sintetis hanya akan menguji salinan test-nya sendiri, bukan
// kodenya (lulus palsu). Yang bisa salah dan bisa diuji adalah registry di atas.
