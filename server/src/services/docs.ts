import { resolveRepoDir } from "./local-binding";
import { scanRepoDocs, readDocFile, writeDocFile, deleteDocFile } from "./scan";

// SPEC-217 · path efektif = binding lokal per-mesin ?? Project.repoDir (bukan repoDir mentah).
async function repoDirOf(projectId: string): Promise<string | null> {
  return resolveRepoDir(projectId);
}

export async function docIndex(projectId: string) {
  return scanRepoDocs(await repoDirOf(projectId));
}
export async function readDoc(projectId: string, path: string): Promise<string | null> {
  const dir = await repoDirOf(projectId);
  return dir ? readDocFile(dir, path) : null;
}
export async function writeDoc(projectId: string, path: string, content: string): Promise<void> {
  const dir = await repoDirOf(projectId);
  if (!dir) throw new Error("project tidak punya repoDir");
  writeDocFile(dir, path, content);
}
export async function deleteDoc(projectId: string, path: string): Promise<boolean> {
  const dir = await repoDirOf(projectId);
  return dir ? deleteDocFile(dir, path) : false;
}
