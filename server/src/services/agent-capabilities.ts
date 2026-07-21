import { grantsCapability, type Capability } from "@hanoman/shared";

// SPEC-257 · ADR-0065 · peta route→capability. path = req.url tanpa query (mis. /api/projects/foo/docs/x.md).
// write meng-implikasikan read (grantsCapability). Route tak dikenal → null → gate perlakukan cookie-only.
type Resolved = Capability | "COOKIE_ONLY" | "GLOBAL_READ" | null;

const IDE_SUBS = new Set([
  "tree", "file", "working-status", "file-diff", "graph", "commit", "git",
  "status", "stashes", "remotes", "compare", "archive", "pr-url",
]);

export function capabilityForRoute(method: string, path: string): Resolved {
  const read = method === "GET" || method === "HEAD";
  const rw = (d: string): Capability => `${d}:${read ? "read" : "write"}` as Capability;
  const seg = path.replace(/^\/api\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const top = seg[0] ?? "";

  // tak-boleh-didelegasikan
  if (top === "auth" || top === "agent-tokens" || top === "device-tokens" || top === "sync") return "COOKIE_ONLY";
  // read-only global (status)
  if (top === "limits" || top === "update" || top === "events" || top === "fs" || top === "health") return "GLOBAL_READ";
  if (top === "settings" || top === "config") return rw("settings");
  if (top === "specs") return rw("backlog");
  if (top === "notifications") return rw("notifications");
  if (top === "errors" || top === "tickets") return rw("support");
  if (top === "vps") return rw("vps");
  if (top === "prds") return rw("docs");
  if (top === "terminal") {
    if (seg[seg.length - 1] === "ws") return "sessions:write"; // WS = kontrol interaktif
    return rw("sessions");
  }
  if (top === "projects") {
    const sub = seg[2]; // seg[1] = :id
    if (sub === "docs" || sub === "prds") return rw("docs");
    if (sub && IDE_SUBS.has(sub)) return rw("ide");
    return rw("projects");
  }
  return null;
}

export function checkAgentCapability(caps: string[], method: string, path: string):
  { ok: true } | { ok: false; status: 403; need?: string; reason: "cookie-only" | "capability" } {
  const need = capabilityForRoute(method, path);
  if (need === "GLOBAL_READ") return { ok: true };
  if (need === "COOKIE_ONLY" || need === null) return { ok: false, status: 403, reason: "cookie-only" };
  if (grantsCapability(caps, need)) return { ok: true };
  return { ok: false, status: 403, need, reason: "capability" };
}
