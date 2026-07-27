import { zAuditEscalation, type AuditEscalation } from "@hanoman/shared";
import { listSpecDocs, resolveDir } from "./spec-docs";
import { readDocFile } from "./scan";
import { listSessions } from "./pty";

// SPEC-340 · ADR-0076 · rekomendasi tindak lanjut audit hidup di DOKUMEN audit sebagai satu blok
// ```json kanonik (pola manifest breakdown, ADR-0069) — bukan kolom DB (ADR-0018/0011).
// Defensif seperti parseBreakdown: manifest ditulis agen, jadi apa pun yang tak lolos zod → null.
export function parseEscalation(md: string): AuditEscalation | null {
  const m = md.match(/```json\s*([\s\S]*?)```/);   // blok PERTAMA, sama seperti parseBreakdown
  if (!m) return null;
  let data: unknown;
  try { data = JSON.parse(m[1]!); } catch { return null; }
  const raw = data && typeof data === "object" ? (data as { escalation?: unknown }).escalation : undefined;
  if (!raw) return null;
  const p = zAuditEscalation.safeParse(raw);
  return p.success ? p.data : null;
}

// Dokumen audit milik sebuah spec, dibaca freshest-wins: cwd sesi HIDUP > repoDir (resolveDir,
// SPEC-170). listSpecDocs sudah mengklasifikasi `research/audit-*` / `*-audit.md` sbg kind "audit"
// (SPEC-237); ambil yang pertama — urutan ORDER-nya sudah dipimpin kind audit.
async function findAuditDoc(
  specId: string, sessions: ReturnType<typeof listSessions>,
): Promise<{ dir: string; path: string; live: boolean } | null> {
  const dir = await resolveDir(specId, sessions);
  if (!dir) return null;
  const live = sessions.some((s) => s.specId === specId && !s.exited && s.cwd);
  const doc = (await listSpecDocs(specId, sessions)).find((d) => d.kind === "audit");
  return doc ? { dir, path: doc.path, live } : null;
}

export async function readAuditDoc(
  specId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<{ path: string; content: string } | null> {
  const found = await findAuditDoc(specId, sessions);
  if (!found) return null;
  const content = readDocFile(found.dir, found.path);
  return content === null ? null : { path: found.path, content };
}

export async function readEscalation(
  specId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<{ escalation: AuditEscalation | null; docPath: string | null; live: boolean }> {
  const found = await findAuditDoc(specId, sessions);
  if (!found) {
    // Tak ada dokumen audit sama sekali: tetap laporkan `live` apa adanya supaya UI bisa
    // membedakan "sesi sedang menulis" dari "audit lama tanpa rekomendasi".
    const live = sessions.some((s) => s.specId === specId && !s.exited && s.cwd);
    return { escalation: null, docPath: null, live };
  }
  const content = readDocFile(found.dir, found.path);
  return {
    escalation: content === null ? null : parseEscalation(content),
    docPath: found.path,
    live: found.live,
  };
}
