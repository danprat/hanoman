import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { prisma } from "../db";
import { zTerminalSession, zIntegrate, type Stage } from "@hanoman/shared";
import { realGit, startProjectPrompt, startPrdPrompt, startScaffoldPrompt, startBreakdownPrompt, startCrossAuditPrompt, type Flow } from "@hanoman/runner";
import { buildCrossAuditCtx, crossAuditSessionOpts } from "../services/cross-audit";
import { phaseFilePath, decisionFilePath, readPhases, stageForRun } from "../services/session-phases";
import { specReview, reviewFile } from "../services/spec-review";
import { downloadFormat, sendReviewDownload } from "../services/doc-export";
import { integrateBranch } from "../services/integrate";
import { sessionAgentDefaults, conflictSessionDefaults } from "../services/settings";
import { ensureCodexTrust } from "../services/codex-trust";
import { startSpecSession, LaunchError } from "../services/session-launch";
import { resolveRepoDir } from "../services/local-binding";
import { ownsWorktree } from "../services/session-worktree";
import { readPrd } from "../services/project-prds";
import { readAuditDoc } from "../services/audit-escalation";
import { recordSessionResult } from "../services/session-result";
import { recordCompletion } from "../services/notifications";
import { STAGES } from "../services/stage-machine";
import {
  createSession, getSession, listSessions, killSession, sessionPhases,
  attach, detach, writeTo, resize, shellBin, type Client,
} from "../services/pty";

// Sebuah PTY di atas WebSocket adalah remote code execution secara desain — identik
// dengan menyerahkan shell. hanoman tidak punya autentikasi; satu-satunya yang berdiri
// di antara endpoint ini dan jaringan adalah server.ts yang bind ke 127.0.0.1.
// Bila HOST pernah diubah ke 0.0.0.0, endpoint inilah yang pertama harus digembok.

// Stage hanya maju (ADR-0008). Agen bisa saja tak pernah menulis berkas fasenya; itu tak
// boleh menyeret backlog item mundur ke `brainstorming`.
async function advanceStage(
  specId: string, repoDir: string, sessionId: string, flow: Flow, worktree: string,
): Promise<void> {
  // stageForRun (bukan stageFor): `Execute done` tak boleh mencapai `done` selama plan
  // spec-nya di worktree masih punya `- [ ]` — tahan di `executing` (SPEC-173, ADR-0029).
  const next = stageForRun(readPhases(phaseFilePath(repoDir, sessionId), flow), worktree, specId);
  if (!next) return;
  const spec = await prisma.spec.findUnique({ where: { id: specId }, select: { stage: true, title: true, projectId: true } });
  if (!spec || STAGES.indexOf(next) <= STAGES.indexOf(spec.stage as Stage)) return;
  // CAS (SPEC-197): hanya maju bila stage DB belum berubah sejak dibaca. Revert konkuren
  // (PATCH /specs mundur + hapus artefak docs) tak boleh ter-overwrite maju lagi.
  const { count } = await prisma.spec.updateMany({ where: { id: specId, stage: spec.stage }, data: { stage: next } });
  if (count === 0) return; // stage berubah di bawah kita → jangan lanjut ke recordCompletion
  // SPEC-213 · ADR-0047 · catat ringkasan hasil (activity log) untuk transisi stage ini —
  // whitelist field saja, tanpa transkrip/kredensial (AC-20/21). Best-effort: jangan blok sesi.
  let commitSha: string | null = null;
  try { commitSha = realGit.headSha(worktree); } catch { /* worktree lenyap */ }
  await recordSessionResult({
    projectId: spec.projectId, specId, oldStage: spec.stage, newStage: next,
    commitSha, branch: `hanoman/${sessionId}`, status: next === "done" ? "done" : "progress",
  }).catch(() => { /* activity log opsional */ });
  // SPEC-180 · transisi masuk `done` (guard di atas menjamin stage lama < done).
  if (next === "done") await recordCompletion(specId, spec.title, spec.projectId);
}

export default async function (app: FastifyInstance) {
  app.get("/terminal/sessions", async () => listSessions());

  app.post("/terminal/sessions", async (req, reply) => {
    const parsed = zTerminalSession.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });

    // Sesi backlog item: `claude` interaktif di worktree-nya sendiri, dengan prompt awal yang
    // memuat objective dan pipeline fase-nya (SPEC-162). SPEC-294 · jalur peluncuran diseragamkan
    // di startSpecSession() (dipakai bersama governor scheduler); route memetakan LaunchError → status.
    if ("spec" in parsed.data) {
      const spec = await prisma.spec.findUnique({ where: { id: parsed.data.spec } });
      if (!spec) return reply.code(404).send({ error: "spec not found" });
      try {
        const r = await startSpecSession(spec, {
          flow: parsed.data.flow, model: parsed.data.model, effort: parsed.data.effort,
          goal: parsed.data.goal, goalCondition: parsed.data.goalCondition,   // SPEC-332 · ADR-0073
          agent: parsed.data.agent,                                           // SPEC-338 · ADR-0074
          verifyScope: parsed.data.verifyScope,                               // SPEC-376 · ADR-0080
        });
        // SPEC-394 · ADR-0084 · `resumed` hanya muncul saat peluncuran benar-benar MELANJUTKAN
        // artefak sesi sebelumnya. Aditif — klien yang hanya membaca `id` tak terpengaruh.
        return reply.code(201).send(r.resumed ? { id: r.id, resumed: true } : { id: r.id });
      } catch (e) {
        if (e instanceof LaunchError) {
          // Parity status: needs-bind → 400 {needsBind}, worktree gagal → 422.
          return e.kind === "needs-bind"
            ? reply.code(400).send({ error: e.message, needsBind: true })
            : reply.code(422).send({ error: e.message });
        }
        throw e;
      }
    }

    const project = await prisma.project.findUnique({ where: { id: parsed.data.project } });
    if (!project) return reply.code(404).send({ error: "project not found" });

    // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project. Reuse cabang
    // createSession({command}) (ADR-0042/0056). Tanpa flow → tak menggerakkan stage; cwd=repoDir
    // (bukan .worktrees) → DELETE hanya kill pane, tak menyentuh working tree. Ditaruh sebelum
    // guard repoDir lama supaya TS menyempitkan varian shell keluar sebelum `parsed.data.flow`.
    // `shell` = z.literal(true), jadi keberadaannya cukup mengidentifikasi varian (tanpa `&&
    // parsed.data.shell` yang menggagalkan penyempitan control-flow di cabang else).
    if ("shell" in parsed.data) {
      const repoDir = await resolveRepoDir(project.id);
      if (!repoDir) return reply.code(400)
        .send({ error: `project "${project.id}" belum di-bind ke checkout lokal`, needsBind: true });
      const s = createSession(project.id, repoDir, { command: [shellBin()] });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-8). Kode status
    // dipertahankan (flow → 422, non-flow → 400) untuk parity; `needsBind` memberi sinyal UI.
    const repoDir = await resolveRepoDir(project.id);
    if (!repoDir) {
      return reply.code(parsed.data.flow ? 422 : 400)
        .send({ error: `project "${project.id}" belum di-bind ke checkout lokal`, needsBind: true });
    }

    // SPEC-166 · sesi reverse: worktree + prompt standar docs, tanpa Spec. Id deterministik
    // dari project-nya supaya Start kedua menyambung ke sesi yang sama (ADR-0015).
    if (parsed.data.flow === "reverse") {
      const id = `reverse-${project.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      // SPEC-252 · ADR-0061 · default global (per sesi). SPEC-338 · ADR-0074 · sesi project-level
      // tak punya picker: ia mengikuti agen default global.
      const { agent, model, effort } = await sessionAgentDefaults();
      if (agent === "codex") ensureCodexTrust(repoDir);
      try {
        // HEAD, bukan "main": repo target bukan milik hanoman — default branch-nya bebas.
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, flow: "reverse", model, effort, agent,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startProjectPrompt("reverse", {
          id: project.id, name: project.name, desc: project.desc, stack: project.stack,
        }, "reverse-docs"),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-222 · sesi scaffold project-level: dari ide → Source of Truth penuh. Id deterministik
    // dari project (Start kedua menyambung, ADR-0015). Cermin reverse; diseed dari project.desc.
    if (parsed.data.flow === "scaffold") {
      const id = `scaffold-${project.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      // SPEC-252 · ADR-0061 · default global (per sesi). SPEC-338 · ADR-0074 · sesi project-level
      // tak punya picker: ia mengikuti agen default global.
      const { agent, model, effort } = await sessionAgentDefaults();
      if (agent === "codex") ensureCodexTrust(repoDir);
      try {
        // SPEC-223 · "project baru pasti kosongan": repoDir bisa BELUM ada di disk saat scaffold
        // (project di-sync dari device lain, folder dipindah/hapus, atau init-saat-create tak jalan).
        // initRepo idempoten (mkdir + git init + commit seed bila belum ada HEAD) — jaring pengaman
        // agar scaffold dari ide tak pernah mati `spawnSync git ENOENT`. Scaffold ⟺ from-scratch,
        // jadi memiliki lifecycle repo kosong memang tugasnya (bukan mengasumsikannya, ADR-0052).
        realGit.initRepo(repoDir);
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, flow: "scaffold", model, effort, agent,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startScaffoldPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          "scaffold-docs"),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-210 · sesi prd project-level: PM menyusun dokumen PRD dari brief + brainstorm. Meniru
    // reverse (worktree isolasi, push ke branch prd/<slug>, manusia merge). Tanpa Spec: DELETE
    // session tak menggerakkan stage (dijaga `if (s.specId)`), worktree tetap dibersihkan.
    if (parsed.data.flow === "prd") {
      const { brief, branchFrom, fromAudit } = parsed.data;
      const slug = brief.title.toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      if (!slug) return reply.code(400).send({ error: "judul PRD kosong" });
      const id = `prd-${slug}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      // SPEC-252 · ADR-0061 · default global (per sesi). SPEC-338 · ADR-0074 · sesi project-level
      // tak punya picker: ia mengikuti agen default global.
      const { agent, model, effort } = await sessionAgentDefaults();
      if (agent === "codex") ensureCodexTrust(repoDir);
      try {
        // HEAD, bukan "main": repo target bukan milik hanoman — default branch-nya bebas.
        // SPEC-340 · ADR-0076 · PRD hasil eskalasi audit lahir dari branch auditnya, supaya
        // dokumen audit ada di worktree & jejak git PRD bersambung dengan auditnya.
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, branchFrom ?? "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      // SPEC-340 · isi dokumen audit (freshest-wins) disematkan ke prompt — prompt self-contained,
      // lepas dari status merge branch audit. Dokumen tak terbaca → PRD tetap jalan tanpa blok itu.
      const auditDoc = fromAudit ? await readAuditDoc(fromAudit) : null;
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, flow: "prd", branch: `prd/${slug}`, model, effort, agent,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startPrdPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          brief, `prd/${slug}`,
          auditDoc ? { id: fromAudit!, path: auditDoc.path, content: auditDoc.content } : undefined),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-273 · sesi breakdown project-level: pecah SATU PRD → manifest N backlog paralel-independen.
    // Meniru prd (worktree isolasi dari HEAD, push branch breakdown/<slug>, manusia review→materialize).
    // Isi PRD disematkan ke prompt (freshest-wins), jadi breakdown lepas dari status merge PRD.
    if (parsed.data.flow === "breakdown") {
      const { prdPath } = parsed.data;
      const content = await readPrd(project.id, prdPath); // gate: hanya docs/prd/*.md, freshest-wins
      if (content === null) return reply.code(400).send({ error: "PRD tak terbaca" });
      const base = prdPath.slice(prdPath.lastIndexOf("/") + 1).replace(/\.md$/, "");
      const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      if (!slug) return reply.code(400).send({ error: "path PRD tak valid" });
      const id = `breakdown-${slug}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      // SPEC-252 · ADR-0061 · default global (per sesi). SPEC-338 · ADR-0074 · sesi project-level
      // tak punya picker: ia mengikuti agen default global.
      const { agent, model, effort } = await sessionAgentDefaults();
      if (agent === "codex") ensureCodexTrust(repoDir);
      try {
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const titleM = content.match(/^#\s+(.+)$/m);
      const title = titleM ? titleM[1]!.trim() : slug;
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, flow: "breakdown", branch: `breakdown/${slug}`, model, effort, agent,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startBreakdownPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          { title, path: prdPath, content }, `breakdown/${slug}`),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-337 · ADR-0075 · sesi audit LINTAS project yang lepas (tanya-jawab): worktree sendiri,
    // TANPA Spec/fase/branch → tak menggerakkan stage apa pun. Id deterministik dari project
    // (Start kedua = re-attach, ADR-0015). Kunci baca log ikut lahir & mati bersama sesi.
    if (parsed.data.flow === "cross-audit") {
      const id = `xaudit-${project.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
      const live = getSession(id);
      if (live) return reply.code(201).send({ id: live.id });

      const built = await buildCrossAuditCtx(project.id);
      if (!built) return reply.code(404).send({ error: "project not found" });
      // SPEC-338 · ADR-0074 · sesi project-level tak punya picker: ikut agen default global.
      const { agent, model, effort } = await sessionAgentDefaults();
      if (agent === "codex") ensureCodexTrust(repoDir);
      try {
        // HEAD, bukan "main": repo target bukan milik hanoman — default branch-nya bebas.
        realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, `${repoDir}/.worktrees/${id}`, {
        id, model, effort, agent,
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startCrossAuditPrompt({ ...built.ctx, worktree: `${repoDir}/.worktrees/${id}` }, "live"),
        ...crossAuditSessionOpts(built.scope),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-338 · ADR-0074 · terminal agen biasa (bukan shell mentah) ikut agen default global,
    // termasuk model/effort-nya — sebelumnya jalur ini lahir tanpa argv model sama sekali.
    const { agent, model, effort } = await sessionAgentDefaults();
    if (agent === "codex") ensureCodexTrust(repoDir);
    const s = createSession(project.id, repoDir, { agent, model, effort });
    return reply.code(201).send({ id: s.id });
  });

  app.get("/terminal/sessions/:id/phases", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSession(id);
    const phases = sessionPhases(id);
    if (!s?.flow || !phases) return reply.code(404).send({ error: "not found" });
    return { flow: s.flow, phases };
  });

  // SPEC-230 · review diff worktree hidup sebuah sesi project-level (PRD). Kunci worktree = id
  // sesi (worktreeDir(repoDir, id) === s.cwd). Tanpa baseSha/branchFrom → mergeBase jatuh ke
  // default repo/HEAD (SPEC-227). Worktree lenyap (sesi ditutup) → 409, bukan 500.
  type WtOk = { ok: true; id: string; repoDir: string };
  type WtErr = { ok: false; code: number; msg: string };
  const sessionWorktree = async (id: string): Promise<WtOk | WtErr> => {
    const s = getSession(id);
    if (!s) return { ok: false, code: 404, msg: "not found" };
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir) return { ok: false, code: 409, msg: "project belum punya repoDir" };
    if (!s.cwd.includes("/.worktrees/") || !existsSync(s.cwd))
      return { ok: false, code: 409, msg: "belum ada worktree untuk di-review — jalankan/lanjutkan sesi dulu" };
    return { ok: true, id: s.id, repoDir };
  };
  app.get("/terminal/sessions/:id/review", async (req, reply) => {
    const r = await sessionWorktree((req.params as { id: string }).id);
    if (!r.ok) return reply.code(r.code).send({ error: r.msg });
    return specReview(r.repoDir, r.id, null, null);
  });
  app.get("/terminal/sessions/:id/review/*", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const r = await sessionWorktree(id);
    if (!r.ok) return reply.code(r.code).send({ error: r.msg });
    const rf = await reviewFile(r.repoDir, r.id, null, null, path);
    if (rf === null) return reply.code(404).send({ error: "not found" });
    // SPEC-385 · ADR-0078 · sama seperti review backlog; Review sesi PRD memakai layar yang sama.
    const fmt = downloadFormat(req.query);
    if (fmt) return sendReviewDownload(reply, fmt, rf, { prefix: id, eyebrow: `hanoman · ${id}`, path });
    return rf;
  });

  // SPEC-230 · rebase/merge branch sesi project-level (PRD: prd/<slug>). Bersih → langsung;
  // konflik → spawn sesi claude di worktree merge-<id> (tanpa flow → tak menggerakkan stage, ADR-0031).
  app.post("/terminal/sessions/:id/integrate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zIntegrate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "op/target invalid" });
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: "not found" });
    if (!s.branch) return reply.code(409).send({ error: "sesi ini tak punya branch untuk di-integrasi" });
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await integrateBranch(repoDir, { branch: s.branch, mergeId: s.id }, parsed.data.op, parsed.data.target);
    if (r.status === "error") return reply.code(r.code).send({ error: r.error });
    if (r.status === "clean") return { status: "clean", detail: r.detail };
    // conflict → sesi agen interaktif di worktree yang tertinggal (tanpa flow → tak menggerakkan stage).
    // SPEC-338 · ADR-0074 · ikut agen dari Settings, seperti sesi project-level lainnya.
    // SPEC-383 · ADR-0081 · blok `Setting.conflict` bila dinyalakan; mati = default global.
    const { agent, model, effort } = await conflictSessionDefaults();
    if (agent === "codex") ensureCodexTrust(repoDir);
    const prompt = [
      `hanoman · selesaikan konflik ${r.op} branch \`${s.branch}\` ${r.op === "merge" ? "ke" : "di atas"} \`${r.target}\`.`,
      `Kamu berada di worktree yang tertinggal di tengah operasi ${r.op} dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
      r.finalize,
      `Sesi PRD ${s.id}.`,
    ].join("\n\n");
    const cs = createSession(s.projectId, r.worktree, {
      id: `merge-${id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`,
      model, effort, agent, prompt,
    });
    return { status: "conflict", sessionId: cs.id };
  });

  app.delete("/terminal/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: "not found" });

    // Sesi ber-flow (run/reverse) DAN sesi integrasi (SPEC-175, tanpa flow) sama-sama hidup di
    // worktree-nya sendiri di `.worktrees/*` — keduanya harus dibersihkan. Hanya yang ber-spec-flow
    // menggerakkan stage. Terminal biasa (cwd = repoDir) tak tersentuh.
    // SPEC-362 · syarat ini hanya memilih sesi mana yang perlu BOOKKEEPING akhir; penghapusan
    // worktree digerbangi `ownsWorktree` di bawah, karena bentuk path saja bukan bukti kepemilikan.
    if (s.flow || s.cwd.includes("/.worktrees/")) {
      // SPEC-213 · pakai binding lokal (menang atas Project.repoDir) agar worktree sesi ter-bind
      // pada project murni-metadata tetap dibersihkan.
      const repoDir = await resolveRepoDir(s.projectId);
      if (repoDir) {
        // Bacaan terakhir sebelum worktree-nya lenyap: sesudah ini berkas fasenya tak berarti lagi.
        if (s.specId) {
          if (s.flow) await advanceStage(s.specId, repoDir, id, s.flow, s.cwd);
          // HEAD worktree = ujung range review sesudah item selesai (SPEC-176, ADR-0030).
          // Dibaca sebelum removeWorktree; gagal-diam agar tak memblok penutupan sesi.
          try {
            const headSha = realGit.headSha(s.cwd);
            await prisma.spec.update({ where: { id: s.specId }, data: { headSha } });
          } catch { /* HEAD tak resolve — biarkan headSha apa adanya */ }
        }
        killSession(id);
        // SPEC-362 · hanya hapus worktree yang benar-benar milik sesi ini. Tanpa gerbang ini,
        // project yang di-bind ke checkout di bawah `.worktrees/` kehilangan seluruh checkout-nya
        // saat sebuah terminal biasa ditutup (`cwd === repoDir`).
        if (ownsWorktree(repoDir, s.cwd)) realGit.removeWorktree(repoDir, s.cwd);
        return reply.code(204).send();
      }
    }
    killSession(id);
    return reply.code(204).send();
  });

  app.get("/terminal/sessions/:id/ws", { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    if (!getSession(id)) return socket.close(4004, "not found");
    const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
    attach(id, client);
    socket.on("message", (raw: Buffer) => {
      let m: { t?: string; d?: string; cols?: number; rows?: number };
      // ponytail: frame rusak dibuang diam-diam — pengirimnya UI kita sendiri.
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "in" && typeof m.d === "string") writeTo(id, m.d);
      else if (m.t === "resize" && m.cols && m.rows) resize(id, m.cols, m.rows);
    });
    socket.on("close", () => detach(id, client));
  });
}
