import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseAudit, mapToCatalog, scriptPath } from "./vps-audit";
import { CATALOG } from "../vps/catalog/catalog";

describe("integritas probe ↔ audit.sh (SPEC-220)", () => {
  it("setiap item probe:true punya emitter di audit.sh (tak ada item probe-mati)", () => {
    const sh = readFileSync(scriptPath("audit.sh"), "utf8");
    const missing = CATALOG.filter((c) => c.probe).map((c) => c.id)
      .filter((id) => !sh.includes(id));
    expect(missing).toEqual([]);
  });
});

describe("parseAudit (SPEC-220)", () => {
  it("mem-parse baris CHECK itemId termasuk status na", () => {
    const out = [
      "CHECK sudo_ok pass root",       // legacy
      "CHECK fw-b1 pass",              // itemId katalog
      "CHECK ssh-b3 fail PasswordAuthentication yes",
      "CHECK fw-i4 na tidak ada IPv6",
      "beberapa noise dari motd",
    ].join("\n");
    const checks = parseAudit(out);
    expect(checks.find((c) => c.check === "fw-b1")?.status).toBe("pass");
    expect(checks.find((c) => c.check === "ssh-b3")?.status).toBe("fail");
    expect(checks.find((c) => c.check === "fw-i4")?.status).toBe("na");
    expect(checks.find((c) => c.check === "noise")).toBeUndefined();
  });
});

describe("mapToCatalog (SPEC-220)", () => {
  it("itemId asing/legacy diabaikan aman (AC-3), tidak crash", () => {
    const m = mapToCatalog([
      { check: "sudo_ok", status: "pass", detail: "" },   // legacy → bukan katalog
      { check: "tidak-ada", status: "pass", detail: "" },  // asing
      { check: "fw-b1", status: "pass", detail: "" },       // katalog
    ]);
    expect(m["sudo_ok"]).toBeUndefined();
    expect(m["tidak-ada"]).toBeUndefined();
    expect(m["fw-b1"]).toBe("pass");
  });

  it("probe fail tetap fail — tak pernah dianggap pass (AC-7)", () => {
    const m = mapToCatalog([{ check: "ssh-b3", status: "fail", detail: "" }]);
    expect(m["ssh-b3"]).toBe("fail");
  });

  it("probe status na dipetakan ke unknown (bukan pass)", () => {
    const m = mapToCatalog([{ check: "fw-i4", status: "na", detail: "" }]);
    expect(m["fw-i4"]).toBe("unknown");
  });
});
