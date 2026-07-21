// SPEC-276 · ADR-0070 · simpan/temukan source-map per release. Byte di HANOMAN_UPLOAD_DIR (pola
// uploads.ts): server-local, di luar repoDir, TAK disync. Metadata di SourceMapArtifact.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../db";
import { uploadDir } from "./uploads";

// basename dari path/URL: buang query/fragment lalu segmen setelah "/" atau "\".
export function basenameOf(ref: string): string {
  const clean = (ref.split(/[?#]/)[0] ?? "");
  const parts = clean.split(/[/\\]/);
  return parts[parts.length - 1] || clean;
}

export async function saveSourceMap(
  projectId: string, release: string, filename: string, mapText: string, debugId?: string,
): Promise<{ id: string; storageKey: string; size: number }> {
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const base = basenameOf(filename);
  const storageKey = `${randomUUID()}.map`;
  const buf = Buffer.from(mapText, "utf8");
  await writeFile(join(dir, storageKey), buf);
  // upsert: map untuk (project,release,basename) yang sudah ada → ganti berkas & metadata.
  const prev = await prisma.sourceMapArtifact.findUnique({
    where: { projectId_release_filename: { projectId, release, filename: base } },
  });
  const row = await prisma.sourceMapArtifact.upsert({
    where: { projectId_release_filename: { projectId, release, filename: base } },
    update: { storageKey, size: buf.length, debugId: debugId ?? null },
    create: { projectId, release, filename: base, storageKey, size: buf.length, debugId: debugId ?? null },
  });
  if (prev && prev.storageKey !== storageKey)
    await unlink(join(dir, prev.storageKey.replace(/[/\\]/g, ""))).catch(() => {});
  return { id: row.id, storageKey, size: buf.length };
}

export async function findSourceMap(
  projectId: string, release: string, frameFilename: string,
): Promise<string | null> {
  const base = basenameOf(frameFilename);
  const row = await prisma.sourceMapArtifact.findUnique({
    where: { projectId_release_filename: { projectId, release, filename: base } },
  });
  if (!row) return null;
  try {
    const buf = await readFile(join(uploadDir(), row.storageKey.replace(/[/\\]/g, "")));
    return buf.toString("utf8");
  } catch { return null; }
}

// Sisakan `keep` release TERBARU per project; hapus row + berkas map release lama. createdAt desc
// dengan id desc sebagai tiebreaker (cuid monoton) → deterministik meski createdAt seri.
export async function pruneReleases(projectId: string, keep = 10): Promise<void> {
  const rows = await prisma.sourceMapArtifact.findMany({
    where: { projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const order: string[] = [];
  for (const r of rows) if (!order.includes(r.release)) order.push(r.release);
  const keepSet = new Set(order.slice(0, keep));
  const dir = uploadDir();
  for (const r of rows) if (!keepSet.has(r.release)) {
    await unlink(join(dir, r.storageKey.replace(/[/\\]/g, ""))).catch(() => {});
    await prisma.sourceMapArtifact.delete({ where: { id: r.id } }).catch(() => {});
  }
}
