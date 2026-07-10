import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun } from "./factory";
const app = buildApp();
beforeAll(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
});
describe("run control", () => {
  it("steer is accepted", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-1/steer", payload: { message: "pakai backoff 30s" } });
    expect(r.statusCode).toBe(202); expect(r.json().accepted).toBe(true);
  });
  it("rejects an invalid control action", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-1/control", payload: { action: "explode" } });
    expect(r.statusCode).toBe(400);
  });
  it("worktree switch updates branches", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-1/worktree", payload: { branchTo: "release/v1.0" } });
    expect(r.json().branchTo).toBe("release/v1.0");
  });
  it("command status returns lines", async () => {
    const r = await app.inject({ method: "POST", url: "/api/runs/RUN-1/command", payload: { text: "status" } });
    expect(Array.isArray(r.json().lines)).toBe(true);
  });
});

describe("POST /runs/:id/answer (SPEC-157)", () => {
  const ASK = { question: "q", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" };
  const answer = (id: string, value: unknown) =>
    app.inject({ method: "POST", url: `/api/runs/${id}/answer`, payload: { value } });

  it("202 saat value ada di menu", async () => {
    await makeRun({ id: "RUN-AW-1", projectId: "p1", status: "awaiting", pendingAsk: ASK });
    const r = await answer("RUN-AW-1", "b");
    expect(r.statusCode).toBe(202);
    expect(r.json().accepted).toBe(true);
  });

  it("404 saat run tidak ada", async () => expect((await answer("RUN-hantu", "a")).statusCode).toBe(404));

  it("409 saat run tidak sedang menunggu", async () => {
    await makeRun({ id: "RUN-AW-2", projectId: "p1", status: "running" });
    expect((await answer("RUN-AW-2", "a")).statusCode).toBe(409);
  });

  // Run `awaiting` tanpa pendingAsk adalah baris yang tak konsisten — jangan teruskan apa pun.
  it("409 saat awaiting tapi pendingAsk kosong", async () => {
    await makeRun({ id: "RUN-AW-3", projectId: "p1", status: "awaiting" });
    expect((await answer("RUN-AW-3", "a")).statusCode).toBe(409);
  });

  // Batas kepercayaan: value di luar menu tidak boleh sampai ke stdin agen.
  it("400 saat value bukan salah satu option", async () => {
    await makeRun({ id: "RUN-AW-4", projectId: "p1", status: "awaiting", pendingAsk: ASK });
    expect((await answer("RUN-AW-4", "z")).statusCode).toBe(400);
  });

  it("400 saat body tidak sah", async () => {
    await makeRun({ id: "RUN-AW-5", projectId: "p1", status: "awaiting", pendingAsk: ASK });
    expect((await answer("RUN-AW-5", "")).statusCode).toBe(400);
  });
});
