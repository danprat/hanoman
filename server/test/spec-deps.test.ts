import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  dependsOnOf, blockersFor, reaches, blockedNote, mergedInto, __clearGitCaches,
  workTip, blockersForSpec, validateDependsOn, type SpecBlocker,
} from "../src/services/spec-deps";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("Spec.dependsOn (SPEC-447)", () => {
  it("kolom menyimpan array id dan dibaca kembali apa adanya", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "a", source: "brief", stage: "done", priority: "sedang", author: "a", objective: "" } });
    await prisma.spec.create({ data: { id: "SPEC-2", projectId: "p1", title: "b", source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "", dependsOn: ["SPEC-1"] } });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-2" } });
    expect(row!.dependsOn).toEqual(["SPEC-1"]);
  });

  // Tanpa baris ini, spec asal-hub kehilangan dependency-nya di tiap client — dan client akan
  // meluncurkan pekerjaan yang di hub terblokir.
  it("dependsOn ikut menyeberang sync (FIELDS.spec)", async () => {
    const { __FIELDS_FOR_TEST } = await import("../src/services/sync");
    expect(__FIELDS_FOR_TEST.spec).toContain("dependsOn");
  });
});


const dep = (id: string, stage: string, headSha: string | null = null) =>
  [id, { id, stage, headSha }] as [string, { id: string; stage: string; headSha: string | null }];
const mapOf = (...rows: ReturnType<typeof dep>[]) => new Map(rows);

describe("dependsOnOf · pembacaan defensif kolom Json", () => {
  it("null / bukan array / elemen bukan string → []", () => {
    expect(dependsOnOf({ dependsOn: null })).toEqual([]);
    expect(dependsOnOf({})).toEqual([]);
    expect(dependsOnOf({ dependsOn: "SPEC-1" })).toEqual([]);
    expect(dependsOnOf({ dependsOn: { a: 1 } })).toEqual([]);
    expect(dependsOnOf({ dependsOn: [1, null, "SPEC-1", ""] })).toEqual(["SPEC-1"]);
  });
  it("duplikat dibuang, urutan dipertahankan", () => {
    expect(dependsOnOf({ dependsOn: ["SPEC-2", "SPEC-1", "SPEC-2"] })).toEqual(["SPEC-2", "SPEC-1"]);
  });
});

describe("blockersFor · matriks kesiapan dependency", () => {
  const spec = { branchFrom: "main", dependsOn: ["SPEC-1"] };
  const never = () => false;
  const always = () => true;
  // Ujung kerja default: apa yang tercatat di kolom. Test yang menguji fallback branch memasok
  // tipOf sendiri — pemisahan itulah yang menjaga matriks ini tetap murni.
  const byColumn = (d: { headSha: string | null }) => d.headSha;

  it("tanpa dependency → tak pernah menyentuh isMerged", () => {
    let calls = 0;
    expect(blockersFor({ branchFrom: null, dependsOn: [] }, mapOf(), byColumn, () => { calls++; return true; })).toEqual([]);
    expect(calls).toBe(0);
  });
  it("dependency tak ada di DB → missing", () => {
    expect(blockersFor(spec, mapOf(), byColumn, always)).toEqual([{ id: "SPEC-1", reason: "missing" }]);
  });
  it("dependency belum done → unfinished", () => {
    expect(blockersFor(spec, mapOf(dep("SPEC-1", "executing", "abc")), byColumn, always))
      .toEqual([{ id: "SPEC-1", reason: "unfinished" }]);
  });
  // Pelajaran SPEC-431, dipersempit SPEC-475: yang berarti "siap" adalah TAK ADA JEJAK KERJA sama
  // sekali — bukan sekadar kolom headSha yang kosong. hanoman tak pernah membuatkan worktree untuk
  // item itu (selesai manual / pra-ADR-0030), jadi tak ada commit yang bisa dijadikan bukti.
  it("done tanpa jejak kerja apa pun → siap", () => {
    expect(blockersFor(spec, mapOf(dep("SPEC-1", "done", null)), () => null, never)).toEqual([]);
  });
  // SPEC-475 · keadaan mantap sesudah sesi otonom selesai: `stage=done` tapi kolom headSha kosong
  // karena tak ada jalur otonom yang pernah menutup sesi lewat DELETE. Branch sesinya masih ada,
  // dan ia BELUM ter-merge → dependent tak boleh lahir di atas basis yang belum memuatnya.
  it("done, kolom headSha kosong, tapi branch sesinya ada & belum ter-merge → unmerged", () => {
    expect(blockersFor(spec, mapOf(dep("SPEC-1", "done", null)), () => "tip1", never))
      .toEqual([{ id: "SPEC-1", reason: "unmerged" }]);
  });
  it("done + headSha belum ada di basis → unmerged", () => {
    expect(blockersFor(spec, mapOf(dep("SPEC-1", "done", "abc")), byColumn, never))
      .toEqual([{ id: "SPEC-1", reason: "unmerged" }]);
  });
  it("done + headSha sudah ada di basis → siap", () => {
    expect(blockersFor(spec, mapOf(dep("SPEC-1", "done", "abc")), byColumn, always)).toEqual([]);
  });
  // Basis = ref yang akan dipakai addWorktree; tanpa branchFrom itu "HEAD".
  it("basis yang diuji = branchFrom, jatuh ke HEAD saat null", () => {
    const seen: string[] = [];
    blockersFor({ branchFrom: "rilis", dependsOn: ["SPEC-1"] }, mapOf(dep("SPEC-1", "done", "abc")),
      byColumn, (_s, base) => { seen.push(base); return true; });
    blockersFor({ branchFrom: null, dependsOn: ["SPEC-1"] }, mapOf(dep("SPEC-1", "done", "abc")),
      byColumn, (_s, base) => { seen.push(base); return true; });
    expect(seen).toEqual(["rilis", "HEAD"]);
  });
  it("beberapa dependency dilaporkan semua, urut seperti ditulis", () => {
    const out = blockersFor({ branchFrom: "main", dependsOn: ["SPEC-9", "SPEC-1"] },
      mapOf(dep("SPEC-1", "brainstorming")), byColumn, never);
    expect(out).toEqual<SpecBlocker[]>([
      { id: "SPEC-9", reason: "missing" }, { id: "SPEC-1", reason: "unfinished" },
    ]);
  });
});

describe("reaches · deteksi siklus", () => {
  it("true bila target terjangkau dari salah satu titik awal", () => {
    const e = new Map([["B", ["C"]], ["C", ["A"]]]);
    expect(reaches(e, ["B"], "A")).toBe(true);
  });
  it("false bila tak terjangkau, dan tak menggantung pada graf bersiklus", () => {
    const e = new Map([["B", ["C"]], ["C", ["B"]]]);
    expect(reaches(e, ["B"], "A")).toBe(false);
  });
});

describe("blockedNote", () => {
  it("menyebut id dan alasannya", () => {
    expect(blockedNote([{ id: "SPEC-1", reason: "unmerged" }, { id: "SPEC-2", reason: "unfinished" }]))
      .toBe("menunggu SPEC-1 (belum ter-merge), SPEC-2 (belum selesai)");
  });
});

describe("mergedInto · memo 15 detik di atas git", () => {
  function repoMerged(): { dir: string; featSha: string } {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-mi-"));
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    writeFileSync(join(dir, "a"), "1"); g("add", "-A"); g("commit", "-qm", "base"); g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feat");
    writeFileSync(join(dir, "b"), "2"); g("add", "-A"); g("commit", "-qm", "feat");
    const featSha = g("rev-parse", "HEAD").stdout.trim();
    g("checkout", "-q", "main");
    return { dir, featSha };
  }
  it("membaca git, lalu memoisasi jawabannya", () => {
    __clearGitCaches();
    const { dir, featSha } = repoMerged();
    expect(mergedInto(dir, featSha, "main")).toBe(false);
    spawnSync("git", ["merge", "-q", "--no-ff", "-m", "m", "feat"], { cwd: dir });
    expect(mergedInto(dir, featSha, "main")).toBe(false);   // masih jawaban ter-memo
    __clearGitCaches();
    expect(mergedInto(dir, featSha, "main")).toBe(true);
  });
});

// SPEC-475 · kolom `headSha` kosong pada 3 dari 4 item `done` ber-worktree, karena hanya jalur
// DELETE sesi yang pernah menulisnya. Ujung kerja karena itu dicari juga dari branch sesinya —
// nama yang deterministik per ADR-0032 (`hanoman/<sessionIdForSpec(id)>`).
describe("workTip · ujung kerja dependency (SPEC-475)", () => {
  // Repo dengan branch sesi `hanoman/spec-t1` yang berisi satu commit di atas main.
  function repoWithSessionBranch(): { dir: string; tip: string } {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-wt-"));
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    writeFileSync(join(dir, "a"), "1"); g("add", "-A"); g("commit", "-qm", "base"); g("branch", "-M", "main");
    g("checkout", "-q", "-b", "hanoman/spec-t1");
    writeFileSync(join(dir, "b"), "2"); g("add", "-A"); g("commit", "-qm", "kerja");
    const tip = g("rev-parse", "HEAD").stdout.trim();
    g("checkout", "-q", "main");
    return { dir, tip };
  }

  it("kolom headSha menang dan tak menyentuh git sama sekali", () => {
    __clearGitCaches();
    expect(workTip("/tak/ada/repo", { id: "SPEC-T1", stage: "done", headSha: "abc" })).toBe("abc");
  });
  it("kolom kosong → tip branch sesinya", () => {
    __clearGitCaches();
    const { dir, tip } = repoWithSessionBranch();
    expect(workTip(dir, { id: "SPEC-T1", stage: "done", headSha: null })).toBe(tip);
  });
  // Branch yang sudah dihapus karena ter-merge (SPEC-360) tak boleh mengunci dependent-nya:
  // penghapusan itu sendiri buktinya. Tak ada jejak → tak ada yang bisa memblokir.
  it("kolom kosong & branch sesinya tak ada → null", () => {
    __clearGitCaches();
    const { dir } = repoWithSessionBranch();
    expect(workTip(dir, { id: "SPEC-TX", stage: "done", headSha: null })).toBeNull();
  });
});

describe("blockersForSpec · glue DB", () => {
  it("membaca stage & headSha dependency dari DB", async () => {
    await prisma.project.create({ data: { id: "pd", name: "PD", desc: "", kind: "existing" } });
    await prisma.spec.create({ data: { id: "SPEC-D1", projectId: "pd", title: "a", source: "brief", stage: "planned", priority: "sedang", author: "a", objective: "" } });
    const b = await prisma.spec.create({ data: { id: "SPEC-D2", projectId: "pd", title: "b", source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "", dependsOn: ["SPEC-D1"] } });
    expect(await blockersForSpec(b, null)).toEqual([{ id: "SPEC-D1", reason: "unfinished" }]);
  });
  it("tanpa dependency → []", async () => {
    await prisma.project.create({ data: { id: "pe", name: "PE", desc: "", kind: "existing" } });
    const s = await prisma.spec.create({ data: { id: "SPEC-E1", projectId: "pe", title: "a", source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "" } });
    expect(await blockersForSpec(s, null)).toEqual([]);
  });

  // Repro SPEC-475 lewat glue penuh (DB + git sungguhan): inilah keadaan raciklaba.id — SPEC-453
  // `done` dengan headSha kosong, branch sesinya belum ter-merge, dan SPEC-454 diluncurkan 6 detik
  // kemudian di atas basis yang belum memuatnya.
  describe("dependency done yang branch sesinya belum ter-merge", () => {
    function repoChain(): { dir: string } {
      const dir = mkdtempSync(join(tmpdir(), "hanoman-bd-"));
      const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
      g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
      writeFileSync(join(dir, "a"), "1"); g("add", "-A"); g("commit", "-qm", "base"); g("branch", "-M", "main");
      g("checkout", "-q", "-b", "hanoman/spec-f1");
      writeFileSync(join(dir, "b"), "2"); g("add", "-A"); g("commit", "-qm", "kerja F1");
      g("checkout", "-q", "main");
      return { dir };
    }
    async function seed(dir: string) {
      await prisma.project.create({ data: { id: "pf", name: "PF", desc: "", kind: "existing", repoDir: dir } });
      await prisma.spec.create({ data: { id: "SPEC-F1", projectId: "pf", title: "a", source: "brief", stage: "done", priority: "sedang", author: "a", objective: "", baseSha: "base0", headSha: null } });
      return prisma.spec.create({ data: { id: "SPEC-F2", projectId: "pf", title: "b", source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "", dependsOn: ["SPEC-F1"] } });
    }

    it("terblokir unmerged selama branch-nya belum masuk basis", async () => {
      __clearGitCaches();
      const { dir } = repoChain();
      const f2 = await seed(dir);
      expect(await blockersForSpec(f2, dir)).toEqual([{ id: "SPEC-F1", reason: "unmerged" }]);
    });

    it("terbebaskan begitu branch-nya ter-merge ke basis", async () => {
      __clearGitCaches();
      const { dir } = repoChain();
      const f2 = await seed(dir);
      spawnSync("git", ["merge", "-q", "--no-ff", "-m", "m", "hanoman/spec-f1"], { cwd: dir });
      __clearGitCaches();
      expect(await blockersForSpec(f2, dir)).toEqual([]);
    });
  });
});

describe("validateDependsOn", () => {
  beforeEach(async () => {
    await prisma.project.create({ data: { id: "pv", name: "PV", desc: "", kind: "existing" } });
    await prisma.project.create({ data: { id: "pw", name: "PW", desc: "", kind: "existing" } });
    for (const [id, projectId] of [["SPEC-V1", "pv"], ["SPEC-V2", "pv"], ["SPEC-W1", "pw"]] as const)
      await prisma.spec.create({ data: { id, projectId, title: id, source: "brief", stage: "brainstorming", priority: "sedang", author: "a", objective: "" } });
  });
  it("menerima id yang ada di project yang sama, dedup terjaga", async () => {
    expect(await validateDependsOn("SPEC-V2", "pv", ["SPEC-V1", "SPEC-V1"]))
      .toEqual({ ok: true, ids: ["SPEC-V1"] });
  });
  it("menolak id yang tak ada", async () => {
    const r = await validateDependsOn("SPEC-V2", "pv", ["SPEC-ZZ"]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("tak ditemukan");
  });
  it("menolak dependency lintas project", async () => {
    const r = await validateDependsOn("SPEC-V2", "pv", ["SPEC-W1"]);
    expect(r.ok).toBe(false);
  });
  it("menolak referensi ke diri sendiri", async () => {
    const r = await validateDependsOn("SPEC-V2", "pv", ["SPEC-V2"]);
    expect(r.ok).toBe(false);
  });
  it("menolak siklus", async () => {
    await prisma.spec.update({ where: { id: "SPEC-V1" }, data: { dependsOn: ["SPEC-V2"] } });
    const r = await validateDependsOn("SPEC-V2", "pv", ["SPEC-V1"]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("siklus");
  });
  it("spec baru (specId null) tak bisa membentuk siklus", async () => {
    expect(await validateDependsOn(null, "pv", ["SPEC-V1"])).toEqual({ ok: true, ids: ["SPEC-V1"] });
  });
});
