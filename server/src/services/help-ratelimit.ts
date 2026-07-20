// SPEC-253 · ADR-0061 · rate-limit token-bucket in-memory untuk submit keluhan publik — per IP DAN
// per project (cermin error-ingest.ts). Single-process, patuh "tanpa queue/Redis" (ADR-0024).
import { effectiveInt } from "../config";

type Bucket = { tokens: number; ts: number };
const ipBuckets = new Map<string, Bucket>();
const projBuckets = new Map<string, Bucket>();

function take(map: Map<string, Bucket>, k: string, cap: number, now: number): boolean {
  const b = map.get(k) ?? { tokens: cap, ts: now };
  b.tokens = Math.min(cap, b.tokens + ((now - b.ts) * cap) / 60_000); // isi ulang kontinu cap/menit
  b.ts = now;
  if (b.tokens < 1) { map.set(k, b); return false; }
  b.tokens -= 1;
  map.set(k, b);
  return true;
}

export function helpRateOk(projectId: string, ip: string, now = Date.now()): boolean {
  const ipCap = effectiveInt("HANOMAN_HELP_RATE_PER_MIN_IP") ?? 5;
  const projCap = effectiveInt("HANOMAN_HELP_RATE_PER_MIN_PROJECT") ?? 20;
  const okIp = take(ipBuckets, ip, ipCap, now);
  const okProj = take(projBuckets, projectId, projCap, now);
  return okIp && okProj;
}

export function __resetHelpBuckets() { ipBuckets.clear(); projBuckets.clear(); }
