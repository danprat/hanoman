import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { PG_ORDER, chunk, parseMigrateArgs, migrationSteps } from "../src/commands/migrate-pg";

const models = Prisma.dmmf.datamodel.models;

describe("PG_ORDER", () => {
  it("memuat setiap model Prisma tepat sekali", () => {
    expect([...PG_ORDER].sort()).toEqual(models.map((m) => m.name).sort());
    expect(new Set(PG_ORDER).size).toBe(PG_ORDER.length);
  });

  // Invarian yang benar-benar rapuh: FK menolak anak yang datang sebelum induk. Dijaga terhadap
  // DMMF, bukan komentar — model baru tanpa memperbarui urutan = test merah, bukan kegagalan
  // runtime di mesin orang lain.
  it("setiap model muncul SESUDAH induk relasinya (urutan FK sah)", () => {
    const at = new Map<string, number>(PG_ORDER.map((n, i) => [n, i]));
    const problems: string[] = [];
    for (const m of models) {
      for (const f of m.fields) {
        // sisi yang memegang FK adalah yang punya relationFromFields terisi
        if (f.kind !== "object" || !f.relationFromFields?.length) continue;
        if (f.type === m.name) continue;                       // self-relation: urutan baris yang menjamin
        if (at.get(m.name)! < at.get(f.type)!) problems.push(`${m.name}.${f.name} → ${f.type}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("chunk", () => {
  it("memotong sesuai ukuran, sisa ikut", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("kosong → kosong", () => {
    expect(chunk([], 3)).toEqual([]);
  });
  it("lebih kecil dari ukuran potong → satu potong", () => {
    expect(chunk([1], 200)).toEqual([[1]]);
  });
});

describe("parseMigrateArgs", () => {
  it("--from wajib", () => {
    expect(() => parseMigrateArgs([])).toThrow(/--from/);
  });
  it("bentuk lengkap", () => {
    expect(parseMigrateArgs(["--from", "postgresql://x/db", "--to", "/t/a.db", "--dry-run", "--force"]))
      .toEqual({ from: "postgresql://x/db", to: "/t/a.db", dryRun: true, force: true });
  });
  it("default: bukan dry-run, bukan force, target default", () => {
    expect(parseMigrateArgs(["--from", "postgres://x/db"]))
      .toEqual({ from: "postgres://x/db", to: null, dryRun: false, force: false });
  });
  it("--from harus URL postgres (bukan file: — itu targetnya, bukan sumbernya)", () => {
    expect(() => parseMigrateArgs(["--from", "file:/x.db"])).toThrow(/postgres/);
  });
  it("--to tanpa nilai → melempar, tak menelan flag berikutnya", () => {
    expect(() => parseMigrateArgs(["--from", "postgres://x/db", "--to", "--force"])).toThrow(/--to/);
  });
  it("argumen tak dikenal → melempar", () => {
    expect(() => parseMigrateArgs(["--from", "postgres://x/db", "--wat"])).toThrow(/--wat/);
  });
});

describe("migrationSteps", () => {
  const base = { from: "postgres://x/db", to: null, force: false };
  // Regresi: dry-run sempat memanggil count() pada target yang belum dimigrasi dan gagal
  // "The table `main.Project` does not exist". Dry-run adalah pertanyaan tentang SUMBER.
  it("dry-run tak menyentuh target sama sekali", () => {
    expect(migrationSteps({ ...base, dryRun: true }))
      .toEqual({ prepareTarget: false, checkTarget: false, write: false });
  });
  it("run sungguhan menyiapkan, memeriksa, lalu menulis target", () => {
    expect(migrationSteps({ ...base, dryRun: false }))
      .toEqual({ prepareTarget: true, checkTarget: true, write: true });
  });
  it("--force tak mengubah langkah — ia hanya mengubah reaksi saat target berisi", () => {
    expect(migrationSteps({ ...base, dryRun: false, force: true }))
      .toEqual(migrationSteps({ ...base, dryRun: false }));
  });
});
