import type { FastifyInstance } from "fastify";
import { basename } from "node:path";
import { prisma } from "../db";
import { resolveRepoDir } from "../services/local-binding";
import { listSessions, createSession } from "../services/pty";
import { sessionModel } from "../services/settings";
import { mergeIntoCurrent, rebaseOntoCurrent, pullIntoCurrent, dropCommit, type GraphMergeResult } from "../services/integrate";
import {
  listRepoTree, readRepoFile, writeRepoFile, listGraph, commitDetail, commitFileDiff, compareCommits, compareFile,
  runGitOp, validateGitOp, touchesTree, repoStatus, listStashes, type GitOp,
} from "../services/git-ide";

// undefined = project tak ada (→404); null = ada tapi tanpa checkout lokal; string = repoDir.
// SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-6).
async function repoOf(id: string): Promise<string | null | undefined> {
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) return undefined;
  return (await resolveRepoDir(id)) ?? null;
}
const activeSessions = (id: string) => listSessions().filter((s) => s.projectId === id && !s.exited).length;

export default async function (app: FastifyInstance) {
  app.get("/projects/:id/tree", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const ref = (req.query as { ref?: string }).ref ?? "";
    return { ref, files: await listRepoTree(repoDir, ref) };
  });

  app.get("/projects/:id/file", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { path, ref } = req.query as { path?: string; ref?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try {
      const f = await readRepoFile(repoDir, path, ref ?? "");
      return f === null ? reply.code(404).send({ error: "not found" }) : f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // PUT /file SENGAJA tak digerbang sesi: menulis file bukan operasi git & tak memindah HEAD.
  app.put("/projects/:id/file", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const b = req.body as { path?: string; content?: string };
    if (!b?.path || typeof b.content !== "string") return reply.code(400).send({ error: "path & content wajib" });
    try { await writeRepoFile(repoDir, b.path, b.content); return { path: b.path, content: b.content }; }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  app.get("/projects/:id/graph", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const limit = Number((req.query as { limit?: string }).limit) || 200;
    return listGraph(repoDir, limit);
  });

  // SPEC-233 · status working tree untuk baris "uncommitted changes" di graph.
  app.get("/projects/:id/status", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    return repoStatus(repoDir);
  });

  // SPEC-233 · daftar stash.
  app.get("/projects/:id/stashes", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    return listStashes(repoDir);
  });

  app.get("/projects/:id/commit/:sha", async (req, reply) => {
    const { id, sha } = req.params as { id: string; sha: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const d = await commitDetail(repoDir, sha);
    return d === null ? reply.code(404).send({ error: "not found" }) : d;
  });

  // SPEC-233 · compare dua commit: file yang beda + per-file diff.
  app.get("/projects/:id/compare", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) return reply.code(400).send({ error: "from & to wajib" });
    return compareCommits(repoDir, from, to);
  });

  app.get("/projects/:id/compare/file", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { from, to, path } = req.query as { from?: string; to?: string; path?: string };
    if (!from || !to || !path) return reply.code(400).send({ error: "from, to & path wajib" });
    try {
      const f = await compareFile(repoDir, from, to, path);
      return f === null ? reply.code(404).send({ error: "not found" }) : f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // SPEC-233 · diff satu file di sebuah commit (vs parent), untuk viewer detail commit.
  app.get("/projects/:id/commit/:sha/file", async (req, reply) => {
    const { id, sha } = req.params as { id: string; sha: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try {
      const f = await commitFileDiff(repoDir, sha, path);
      return f === null ? reply.code(404).send({ error: "not found" }) : f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // Mutasi git. Gerbang sesi aktif (persis DELETE /projects); force melewatinya + menambah -f/-D.
  app.post("/projects/:id/git", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const op = req.body as GitOp & { force?: boolean };
    const err = validateGitOp(op);
    if (err) return reply.code(400).send({ error: err });
    // SPEC-233/ADR-0055 · hanya op yang menyentuh working tree digerbang sesi aktif; op ref-only
    // (tag/rename/push/fetch/stash-drop) aman berjalan berdampingan dengan sesi.
    if (!op.force && touchesTree(op)) {
      const n = activeSessions(id);
      if (n) return reply.code(409).send({ error: `project "${id}" punya ${n} sesi aktif; commit/stash atau paksa` });
    }
    const r = await runGitOp(repoDir, op);
    return r.ok ? r : reply.code(409).send({ error: r.stderr || "operasi git gagal", ...r });
  });

  // SPEC-229 · merge via git graph (ADR-0053): deterministik di worktree isolasi (working tree utama
  // tak pernah dirusak), konflik → spawn sesi claude di worktree itu. Tanpa gerbang sesi aktif —
  // isolasi + ff-aman menggantikan alasan 409 lama. Bentuk response mirror POST /specs/:id/integrate.
  app.post("/projects/:id/git/merge", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { source?: unknown; ff?: unknown; deleteBranch?: unknown };
    if (typeof b?.source !== "string" || !b.source) return reply.code(400).send({ error: "source wajib" });
    if (b.ff !== undefined && b.ff !== "no-ff" && b.ff !== "ff-only") return reply.code(400).send({ error: "ff harus no-ff atau ff-only" });
    if (b.deleteBranch !== undefined && !(typeof b.deleteBranch === "string" && b.deleteBranch)) return reply.code(400).send({ error: "deleteBranch harus string tak kosong" });
    const r = await mergeIntoCurrent(repoDir, b.source, {
      ff: b.ff as "no-ff" | "ff-only" | undefined, deleteBranch: b.deleteBranch as string | undefined });
    return finishGraphOp(reply, id, r, "merge");
  });

  // SPEC-233/ADR-0055 · rebase branch current ke commit/branch (isolasi + konflik → sesi claude).
  app.post("/projects/:id/git/rebase", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { onto?: unknown };
    if (typeof b?.onto !== "string" || !b.onto) return reply.code(400).send({ error: "onto wajib" });
    return finishGraphOp(reply, id, await rebaseOntoCurrent(repoDir, b.onto), "rebase");
  });

  // SPEC-233 · pull remote branch ke current (fetch + merge, isolasi + konflik → sesi claude).
  app.post("/projects/:id/git/pull", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { source?: unknown; ff?: unknown };
    if (typeof b?.source !== "string" || !b.source) return reply.code(400).send({ error: "source wajib" });
    if (b.ff !== undefined && b.ff !== "no-ff" && b.ff !== "ff-only") return reply.code(400).send({ error: "ff harus no-ff atau ff-only" });
    return finishGraphOp(reply, id, await pullIntoCurrent(repoDir, b.source, { ff: b.ff as "no-ff" | "ff-only" | undefined }), "pull");
  });

  // SPEC-233 · buang satu commit dari branch current (isolasi + konflik → sesi claude).
  app.post("/projects/:id/git/drop", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { sha?: unknown };
    if (typeof b?.sha !== "string" || !b.sha) return reply.code(400).send({ error: "sha wajib" });
    return finishGraphOp(reply, id, await dropCommit(repoDir, b.sha), "drop");
  });
}

// SPEC-233 · penyelesaian seragam operasi graph isolasi (merge/rebase/pull/drop): error → kode;
// clean → { status, detail }; conflict → spawn sesi claude di worktree yang tertinggal → sessionId.
async function finishGraphOp(reply: import("fastify").FastifyReply, id: string, r: GraphMergeResult, verb: string) {
  if (r.status === "error") return reply.code(r.code).send({ error: r.error });
  if (r.status === "clean") return { status: "clean", detail: r.detail };
  const { model, effort } = await sessionModel();
  const prompt = [
    `hanoman · selesaikan konflik ${verb} \`${r.source}\` → \`${r.target}\`.`,
    `Kamu berada di worktree yang tertinggal di tengah ${verb} dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
    r.finalize,
    `${verb} via git graph project ${id}.`,
  ].join("\n\n");
  const s = createSession(id, r.worktree, { id: basename(r.worktree), model, effort, prompt });
  return { status: "conflict", sessionId: s.id };
}
