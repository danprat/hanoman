import parser from "cron-parser";

// `interval` detail is a duration like "6h"/"30m"/"90s"/"1d"; `schedule` detail
// is a cron expression. These turn a trigger's `detail` into a BullMQ repeat spec.
const UNIT: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

export function parseDuration(s: string): number | null {
  const m = /^(\d+)(s|m|h|d)$/.exec(s.trim());
  return m ? Number(m[1]) * UNIT[m[2]!]! : null;
}

export function isValidCron(s: string): boolean {
  try { parser.parseExpression(s); return true; } catch { return false; }
}

// null for commit/manual (no schedule) and for schedule/interval whose detail is
// invalid — callers treat null as "remove any existing scheduler".
export function scheduleSpecFor(type: string, detail: string): { pattern: string } | { every: number } | null {
  if (type === "schedule") return isValidCron(detail) ? { pattern: detail } : null;
  if (type === "interval") { const ms = parseDuration(detail); return ms ? { every: ms } : null; }
  return null;
}
