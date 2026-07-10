import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { mkdtempSync, appendFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { killAll, killSession, listSessions } from "../src/services/pty";
import { phaseFilePath } from "../src/services/session-phases";
import { resetDb, makeProject, makeSpec } from "./factory";

// Lihat pty.test.ts: /bin/cat mati karena --dangerously-skip-permissions ilegal baginya.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

const app = buildApp({ requireAuth: false });
let origin = "";
let repoDir = "";

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 20));
  }
};

type Frame = { t: string; d?: string; code?: number };
function connect(id: string) {
  const ws = new WebSocket(`ws://${origin}/api/terminal/sessions/${id}/ws`);
  const frames: Frame[] = [];
  ws.on("message", (raw: Buffer) => { frames.push(JSON.parse(raw.toString())); });
  const opened = new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("error", rej); });
  const data = () => frames.filter((f) => f.t === "data").map((f) => f.d ?? "").join("");
  return { ws, frames, opened, data };
}
const createSession = async () => {
  const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "p1" } });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
};

beforeAll(async () => {
  // Sesi tmux test selamat antar-run (ADR-0016) sementara repoDir lahir baru: sesi basi
  // ber-id sama (spec-900, reverse-p1) membuat jalur idempoten ADR-0015 melewatkan
  // pembuatan worktree. File ini harus mandiri, bukan berharap pty.test.ts jalan duluan.
  killAll();
  repoDir = mkdtempSync(join(tmpdir(), "hanoman-term-"));
  // `git worktree add --detach <path> <base>` butuh basis yang bisa di-resolve: repo yang
  // baru di-init belum punya satu commit pun.
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t",
    "commit", "-qm", "init", "--allow-empty"], { cwd: repoDir });
  await resetDb();
  await makeProject({ id: "p1", repoDir });
  await makeProject({ id: "p2", name: "p2", repoDir: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  origin = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); });

describe("terminal routes", () => {
  it("streams pty output and the exit code over the websocket", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const id = await createSession();
    const c = connect(id);
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("--dangerously-skip-permissions");
    expect(c.frames.find((f) => f.t === "exit")).toEqual({ t: "exit", code: 0 });
    c.ws.close();
  });

  it("forwards stdin, and replays scrollback to a reconnecting client", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const first = connect(id);
    await first.opened;
    first.ws.send(JSON.stringify({ t: "in", d: "halo\n" }));
    await waitFor(() => first.data().includes("halo"));
    first.ws.close();

    const second = connect(id);
    await second.opened;
    await waitFor(() => second.data().includes("halo"));
    second.ws.close();
  });

  it("accepts a resize without killing the session", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const c = connect(id);
    await c.opened;
    c.ws.send(JSON.stringify({ t: "resize", cols: 120, rows: 40 }));
    c.ws.send(JSON.stringify({ t: "in", d: "masih hidup\n" }));
    await waitFor(() => c.data().includes("masih hidup"));
    expect(c.frames.some((f) => f.t === "exit")).toBe(false);
    c.ws.close();
  });

  it("lists sessions, and DELETE removes one exactly once", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const list = await app.inject({ url: "/api/terminal/sessions" });
    expect(list.json().map((s: { id: string }) => s.id)).toContain(id);

    const del = await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });
    expect(del.statusCode).toBe(204);
    const again = await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });
    expect(again.statusCode).toBe(404);

    const after = await app.inject({ url: "/api/terminal/sessions" });
    expect(after.json().map((s: { id: string }) => s.id)).not.toContain(id);
  });

  it("404s an unknown project and 400s a project with no repoDir", async () => {
    const missing = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "nope" } });
    expect(missing.statusCode).toBe(404);
    const noDir = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "p2" } });
    expect(noDir.statusCode).toBe(400);
  });

  it("closes the socket for an unknown session id", async () => {
    const c = connect("tidakada");
    c.opened.catch(() => {}); // socket ini memang ditutup; jangan biarkan rejection-nya menganggur
    const code = await new Promise<number>((res) => c.ws.on("close", (n: number) => res(n)));
    expect(code).toBe(4004);
  });
});

// SPEC-162: terminal membuka sesi claude interaktif untuk sebuah backlog item, di worktree-nya.
describe("terminal routes · sesi backlog", () => {
  const start = (spec: string, flow = "feature") =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec, flow } });

  it("POST { spec, flow } membuat worktree + sesi bernama spec-nya", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-900", projectId: "p1", objective: "kerjakan sesuatu" });
    const res = await start("SPEC-900");
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("spec-900");
    expect(existsSync(join(repoDir, ".worktrees", "spec-900"))).toBe(true);
  });

  it("POST kedua untuk spec yang sama mengembalikan sesi yang sama, bukan yang kedua", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-901", projectId: "p1" });
    const a = await start("SPEC-901", "qa");
    const b = await start("SPEC-901", "qa");
    expect(a.json().id).toBe(b.json().id);
    expect(listSessions().filter((s) => s.id === "spec-901")).toHaveLength(1);
  });

  it("spec tak dikenal → 404; project tanpa repoDir → 400", async () => {
    expect((await start("SPEC-XXX")).statusCode).toBe(404);
    await makeSpec({ id: "SPEC-902", projectId: "p2" }); // p2.repoDir = null
    expect((await start("SPEC-902")).statusCode).toBe(400);
  });

  it("GET /:id/phases menurunkan fase dari berkas yang ditulis agen", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-903", projectId: "p1" });
    await start("SPEC-903");
    appendFileSync(phaseFilePath(repoDir, "spec-903"), "Brainstorm done\n");
    const res = await app.inject({ url: "/api/terminal/sessions/spec-903/phases" });
    expect(res.json()).toMatchObject({ flow: "feature" });
    expect(res.json().phases[0]).toEqual({ name: "Brainstorm", state: "done" });
    expect(res.json().phases[1].state).toBe("active");
  });

  it("GET /:id/phases untuk sesi project → 404", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    expect((await app.inject({ url: `/api/terminal/sessions/${id}/phases` })).statusCode).toBe(404);
  });

  it("DELETE membuang worktree dan memajukan Spec.stage ke keadaan finalnya", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-904", projectId: "p1", stage: "brainstorming" });
    await start("SPEC-904");
    appendFileSync(phaseFilePath(repoDir, "spec-904"), "Brainstorm done\nObjective done\nSpec done\n");
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-904" })).statusCode).toBe(204);
    expect(existsSync(join(repoDir, ".worktrees", "spec-904"))).toBe(false);
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-904" } });
    expect(spec.stage).toBe("spec-ready");
  });

  it("Spec.stage tak pernah mundur", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-905", projectId: "p1", stage: "planned" });
    await start("SPEC-905");
    appendFileSync(phaseFilePath(repoDir, "spec-905"), "Brainstorm done\n");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-905" });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-905" } });
    expect(spec.stage).toBe("planned");
  });
});

// SPEC-166: reverse menyusun Source of Truth dari kode — sesi project-level di worktree-nya.
describe("terminal routes · sesi reverse", () => {
  const start = (project: string) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project, flow: "reverse" } });

  it("POST { project, flow: reverse } membuat worktree + sesi ber-id deterministik", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const res = await start("p1");
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("reverse-p1");
    expect(existsSync(join(repoDir, ".worktrees", "reverse-p1"))).toBe(true);
  });

  it("POST kedua menyambung ke sesi yang sama (ADR-0015)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const a = await start("p1");
    const b = await start("p1");
    expect(a.json().id).toBe(b.json().id);
    expect(listSessions().filter((s) => s.id === "reverse-p1")).toHaveLength(1);
  });

  it("project tanpa repoDir + flow → 422 (bukan 400)", async () => {
    expect((await start("p2")).statusCode).toBe(422);
  });

  it("GET phases memakai pipeline reverse baru", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1");
    appendFileSync(phaseFilePath(repoDir, "reverse-p1"), "Scan done\n");
    const res = await app.inject({ url: "/api/terminal/sessions/reverse-p1/phases" });
    expect(res.json().flow).toBe("reverse");
    expect(res.json().phases[0]).toEqual({ name: "Scan", state: "done" });
    expect(res.json().phases[1]).toEqual({ name: "Docs teknis", state: "active" });
  });

  it("DELETE membuang worktree sesi reverse — meski tanpa spec", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1");
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/sessions/reverse-p1" })).statusCode).toBe(204);
    expect(existsSync(join(repoDir, ".worktrees", "reverse-p1"))).toBe(false);
  });

  it("prompt sesi reverse memuat standar docs", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const res = await start("p1"); // sesi lama sudah di-DELETE oleh test sebelumnya
    expect(res.statusCode).toBe(201);
    const c = connect("reverse-p1");
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("STANDAR DOCS");
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/reverse-p1" });
  });
});

// SPEC-168: backlog menurunkan stage sesi yang hidup — real time, tanpa menunggu DELETE.
describe("GET /specs · stage live dari sesi", () => {
  const start = (spec: string, flow = "feature") =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec, flow } });
  const stageOf = async (id: string) => {
    const res = await app.inject({ url: "/api/specs" });
    return (res.json() as { id: string; stage: string }[]).find((s) => s.id === id)?.stage;
  };

  it("menurunkan stage dari berkas fase selama sesi hidup, lalu mempersistnya (write-through)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-906", projectId: "p1", stage: "brainstorming" });
    await start("SPEC-906");
    appendFileSync(phaseFilePath(repoDir, "spec-906"), "Brainstorm done\nObjective done\n");

    expect(await stageOf("SPEC-906")).toBe("objective");
    // Durabilitas: read yang melihat kemajuan menuliskannya ke DB, jadi stage selamat
    // meski berkas fase / pane hilang sebelum DELETE (SPEC-168).
    const row = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-906" } });
    expect(row.stage).toBe("objective");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-906" });
  });

  it("stage selamat saat sesi lenyap tanpa DELETE — sudah dipersist saat dibaca", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-909", projectId: "p1", stage: "brainstorming" });
    await start("SPEC-909");
    appendFileSync(phaseFilePath(repoDir, "spec-909"), "Brainstorm done\nObjective done\n");
    expect(await stageOf("SPEC-909")).toBe("objective"); // derive + persist

    killSession("spec-909"); // pane hilang tanpa advanceStage (reboot/tmux mati)
    expect(listSessions().some((s) => s.id === "spec-909")).toBe(false);
    expect(await stageOf("SPEC-909")).toBe("objective"); // dari DB, bukan derive
  });

  it("tak menyeret stage mundur: fase lebih awal dari nilai persist diabaikan", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-907", projectId: "p1", stage: "planned" });
    await start("SPEC-907");
    appendFileSync(phaseFilePath(repoDir, "spec-907"), "Objective done\n"); // → "objective" < "planned"
    expect(await stageOf("SPEC-907")).toBe("planned");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-907" });
  });

  it("spec tanpa sesi: stage = nilai DB apa adanya", async () => {
    await makeSpec({ id: "SPEC-908", projectId: "p1", stage: "objective" });
    expect(await stageOf("SPEC-908")).toBe("objective");
  });
});
