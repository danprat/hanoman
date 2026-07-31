// SPEC-384 · ADR-0092 · migration drop diverifikasi terhadap BERKAS DB, bukan terhadap
// schema.prisma. Skema Prisma yang sudah bersih tak membuktikan apa pun kalau migration.sql-nya
// tak pernah jalan — dan `migrate deploy` yang gagal separuh justru meninggalkan keadaan campuran
// itu: model hilang dari kode, tabelnya masih hidup di berkas.
import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";

const names = async (sql: string): Promise<string[]> =>
  (await prisma.$queryRawUnsafe<{ name: string }[]>(sql)).map((r) => r.name);

describe("SPEC-384 · tabel & kolom dicabut dari berkas DB", () => {
  it("empat tabel hilang", async () => {
    const tables = await names("SELECT name FROM sqlite_master WHERE type='table'");
    for (const t of ["ErrorGroup", "ErrorEvent", "SourceMapArtifact", "ProjectLink"])
      expect(tables).not.toContain(t);
    // Kontrol negatif: tabel yang HARUS selamat. Tanpa ini, migration yang menghapus terlalu
    // banyak (mis. salah urutan DROP/rename) tetap lulus assertion di atas.
    for (const t of ["Project", "Spec", "Ticket", "TicketAttachment", "SyncLog"])
      expect(tables).toContain(t);
  });

  it("Project tak lagi punya kolom DSN, kolom lain utuh", async () => {
    const cols = await names("PRAGMA table_info('Project')");
    expect(cols).not.toContain("ingestKeyHash");
    expect(cols).not.toContain("ingestKeyPrefix");
    // Rebuild tabel menyalin kolom satu per satu; yang terlewat hilang TANPA error. Daftar ini
    // adalah penjaganya.
    for (const c of ["id", "name", "desc", "kind", "repoDir", "gitRemote", "stack",
                     "createdAt", "version", "updatedAt", "helpEnabled", "schedulerOptIn", "leadOptIn"])
      expect(cols).toContain(c);
  });

  it("baris ber-nilai enum yang dicabut sudah dibereskan", async () => {
    const notif = await prisma.notification.count({ where: { type: "error" } });
    expect(notif).toBe(0);
    const spec = await prisma.spec.count({ where: { source: "cross-audit" } });
    expect(spec).toBe(0);
    const feed = await prisma.syncLog.count({ where: { entity: "errorGroup" } });
    expect(feed).toBe(0);
  });
});
