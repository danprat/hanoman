import { prisma } from "../db";
import { coverageOf } from "./coverage";
export async function docIndex(projectId: string) {
  const rows = await prisma.docFile.findMany({ where: { projectId }, orderBy: { path: "asc" } });
  const byCat = new Map<string, { cat: string; files: string[]; linked: boolean; root: boolean }>();
  for (const r of rows) {
    const c = byCat.get(r.category) ?? { cat: r.category, files: [], linked: true, root: r.root };
    // Keep the path minus the category prefix so `${cat}/${file}` round-trips
    // back to the stored path (handles nested files like agents/.claude/x.json).
    c.files.push(r.path.startsWith(r.category + "/") ? r.path.slice(r.category.length + 1) : r.path);
    c.linked = c.linked && r.linked; c.root = c.root || r.root;
    byCat.set(r.category, c);
  }
  const tree = [...byCat.values()];
  return { coverage: coverageOf(rows.map((r) => ({ category: r.category, linked: r.linked }))), tree };
}
export async function readDoc(projectId: string, path: string) {
  const row = await prisma.docFile.findUnique({ where: { projectId_path: { projectId, path } } });
  return row?.content ?? null;
}
export async function writeDoc(projectId: string, path: string, content: string) {
  const category = path.split("/")[0] ?? "root";
  await prisma.docFile.upsert({
    where: { projectId_path: { projectId, path } },
    update: { content },
    create: { projectId, path, category, content, linked: true, root: false },
  });
}
