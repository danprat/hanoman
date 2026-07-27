import { randomBytes } from "node:crypto";
import { auditSessionScope } from "./pty";

// SPEC-337 · ADR-0075 · kunci audit lintas project: dipegang SESI claude milik hanoman sendiri
// (bukan agen eksternal — bandingkan ADR-0065). Hidup di tmux option, mati bersama pane-nya.
export const AUDIT_KEY_HEADER = "x-hanoman-audit-key";

export const newAuditKey = (): string => `hnm_xa_${randomBytes(16).toString("hex")}`;

// Sesi memanggil API di mesin yang sama; server bind 127.0.0.1 (ADR-0028).
export const auditApiUrl = (): string => `http://127.0.0.1:${process.env.PORT ?? 8787}/api/audit`;

// null = tak ada kunci sah → request harus lewat auth normal (cookie/agent token).
export function auditScopeFromReq(req: { headers: Record<string, unknown> }): string[] | null {
  const raw = req.headers[AUDIT_KEY_HEADER];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== "string" || !key) return null;
  return auditSessionScope(key);
}
