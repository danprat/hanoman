import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDb, makeProject, makeSpec } from "./factory";
import { prisma } from "../src/db";
import { toProjectView } from "../src/services/project-view";
import { createSession, killAll, listSessions } from "../src/services/pty";
import { phaseFilePath } from "../src/services/session-phases";

// /bin/cat mati seketika: --dangerously-skip-permissions ilegal baginya. Lihat pty.test.ts.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

// SPEC-197 · toProjectView kini terima baris project + snapshot sesi (bukan id).
const view = async (id: string) =>
  toProjectView(await prisma.project.findUniqueOrThrow({ where: { id } }), listSessions());

let repoDir = "";
describe("project view", () => {
  beforeEach(async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    repoDir = mkdtempSync(join(tmpdir(), "hanoman-pv-"));
    await resetDb();
    await makeProject({ id: "p1", repoDir });
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "planned" });
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "spec-ready" });
    await makeProject({ id: "p2" });
  });
  afterEach(() => { killAll(); });

  it("backlog count reflects its non-done specs", async () => {
    const v = await view("p1"); expect(v.backlog).toBe(2); }); // SPEC-1, SPEC-2

  it("project tanpa sesi hidup → session idle, dan tak ada lagi field `run`", async () => {
    const v = await view("p2");
    expect(v.session).toEqual({ status: "idle", phase: null, flow: null });
    expect(v).not.toHaveProperty("run");
  });

  // Sesi tmux adalah satu-satunya sumber kebenaran soal pekerjaan berjalan (ADR-0016).
  it("sesi backlog yang hidup muncul sebagai running dengan fase aktifnya", async () => {
    createSession("p1", repoDir, {
      specId: "SPEC-1", flow: "feature", prompt: "x", phaseFile: phaseFilePath(repoDir, "spec-1"),
    });
    const v = await view("p1");
    expect(v.session).toMatchObject({ status: "running", flow: "feature", phase: "Brainstorm" });
    expect(v.commit).toContain("hanoman/spec-1");
  });

  it("sesi project biasa (tanpa spec) tidak membuat project tampak sedang bekerja", async () => {
    createSession("p1", repoDir);
    const v = await view("p1");
    expect(v.session.status).toBe("idle");
  });
});
