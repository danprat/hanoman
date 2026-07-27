import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { createSession, killAll, listSessions } from "../src/services/pty";
import { auditScopeFromReq, newAuditKey, AUDIT_KEY_HEADER } from "../src/services/audit-scope";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const req = (key?: string) => ({ headers: key !== undefined ? { [AUDIT_KEY_HEADER]: key } : {} });
const dir = () => mkdtempSync(join(tmpdir(), "hanoman-xa-"));

beforeEach(() => killAll());
afterAll(() => killAll());

describe("kunci audit ber-scope sesi", () => {
  it("membuat kunci berprefiks hnm_xa_ yang tak pernah sama", () => {
    const a = newAuditKey(), b = newAuditKey();
    expect(a).toMatch(/^hnm_xa_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("mengembalikan scope sesi hidup pemilik kunci", () => {
    const key = newAuditKey();
    createSession("web", dir(), { id: "xa-test", command: ["sleep", "30"], audit: { key, projects: ["web", "api"] } });
    expect(auditScopeFromReq(req(key))).toEqual(["web", "api"]);
  });

  it("null untuk kunci tak dikenal, kosong, atau tanpa header", () => {
    expect(auditScopeFromReq(req())).toBeNull();
    expect(auditScopeFromReq(req(""))).toBeNull();
    expect(auditScopeFromReq(req("hnm_xa_deadbeef"))).toBeNull();
  });

  it("null setelah sesinya mati", async () => {
    const key = newAuditKey();
    createSession("web", dir(), { id: "xa-mati", command: ["true"], audit: { key, projects: ["web"] } });
    await new Promise((r) => setTimeout(r, 800));
    expect(auditScopeFromReq(req(key))).toBeNull();
  });

  it("kunci TIDAK PERNAH muncul di listSessions", () => {
    const key = newAuditKey();
    createSession("web", dir(), { id: "xa-bocor", command: ["sleep", "30"], audit: { key, projects: ["web"] } });
    expect(JSON.stringify(listSessions())).not.toContain(key);
  });
});
