import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun, makeDocFile, makeSetting } from "./factory";

const app = buildApp();
const cmd = (id: string, text: string) =>
  app.inject({ method: "POST", url: `/api/runs/${id}/command`, payload: { text } });

describe("run terminal command routing (SPEC-008)", () => {
  beforeEach(async () => {
    await resetDb();
    await makeSetting();                                  // dailyBudget etc. for enqueue
    await makeProject({ id: "p1", repoDir: process.cwd() });
  });

  it("resume re-enqueues (no fabricated line)", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "paused" });
    const res = await cmd("RUN-1", "resume");
    const lines = res.json().lines as { t: string; s: string }[];
    // truthful: re-enqueued, not the old canned "dilanjutkan oleh manusia"
    expect(lines.some((l) => /enqueue/i.test(l.s))).toBe(true);
    expect(lines.some((l) => l.s === "dilanjutkan oleh manusia")).toBe(false);
  });

  it("free text on an active run is steered, not answered by a fake Claude", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
    const res = await cmd("RUN-1", "tolong pakai queue yang ada");
    const lines = res.json().lines as { t: string; s: string }[];
    expect(lines.some((l) => /diteruskan ke run/i.test(l.s))).toBe(true);
    expect(lines.some((l) => /^claude: /.test(l.s))).toBe(false);   // no fabricated reply
  });

  it("free text on an inactive run says the run is not active", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "done" });
    const res = await cmd("RUN-1", "apa kabar");
    const lines = res.json().lines as { t: string; s: string }[];
    expect(lines.some((l) => /tidak aktif/i.test(l.s))).toBe(true);
  });

  it("docs <path> reflects a real file", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
    await makeDocFile({ projectId: "p1", path: "product/prd.md", content: "a\nb\nc" });
    const hit = (await cmd("RUN-1", "docs product/prd.md")).json().lines as { t: string; s: string }[];
    expect(hit.some((l) => l.t === "✓" && /product\/prd\.md/.test(l.s))).toBe(true);
    const miss = (await cmd("RUN-1", "docs nope/x.md")).json().lines as { t: string; s: string }[];
    expect(miss.some((l) => l.t === "✗")).toBe(true);
  });
});
