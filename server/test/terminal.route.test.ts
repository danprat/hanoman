import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { resetDb, makeProject } from "./factory";

// Lihat pty.test.ts: /bin/cat mati karena --dangerously-skip-permissions ilegal baginya.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

const app = buildApp();
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
  repoDir = mkdtempSync(join(tmpdir(), "hanoman-term-"));
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
