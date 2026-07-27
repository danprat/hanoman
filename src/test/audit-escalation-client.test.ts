import { describe, it, expect, vi } from "vitest";
import { paths } from "@hanoman/shared";
import { api } from "../src/api/client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// SPEC-340 · ADR-0076 · rekomendasi eskalasi audit + sesi PRD hasil eskalasi.
describe("api.getEscalation", () => {
  it("memanggil GET /specs/:id/escalation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ escalation: { target: "prd", reason: "r", alternatives: [], prefill: {} }, docPath: "d.md", live: false }));
    const r = await api.getEscalation("SPEC-300");
    expect(fetchMock).toHaveBeenCalledWith(paths.specEscalation("SPEC-300"), expect.anything());
    expect(r.escalation?.target).toBe("prd");
  });
});

describe("api.startPrd meneruskan branchFrom/fromAudit", () => {
  it("menyertakan keduanya di body saat diberikan", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ id: "prd-x" }, 201));
    await api.startPrd("p1", { title: "T", context: "c", outcome: "o" },
      { branchFrom: "hanoman/spec-300", fromAudit: "SPEC-300" });
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ project: "p1", flow: "prd",
      branchFrom: "hanoman/spec-300", fromAudit: "SPEC-300" });
  });
  it("tak mengirim key itu sama sekali saat opts kosong (perilaku lama)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ id: "prd-x" }, 201));
    await api.startPrd("p1", { title: "T", context: "c", outcome: "o" });
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).not.toHaveProperty("branchFrom");
    expect(body).not.toHaveProperty("fromAudit");
  });
});
