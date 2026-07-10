import { z } from "zod";
export const zStage = z.enum(["brainstorming","objective","spec-ready","planned","executing","done"]);
export const zSpecSource = z.enum(["brief","qa"]);
export const zRunStatus = z.enum(["queued","running","awaiting","paused","stopped","failed","done"]);
export const zRunKind = z.enum(["feature","qa","scaffold"]);
export const zTriggerType = z.enum(["commit","schedule","manual","interval"]);
export const zTriggerTarget = z.enum(["plan + execute","audit","qa audit","scaffold docs"]);
export const zDocStatus = z.enum(["ok","drift","broken"]);
export const zPriority = z.enum(["tinggi","sedang","rendah"]);
export const zProjectKind = z.enum(["from-scratch","existing"]);
export const zSeverity = z.enum(["critical","major","minor"]);

// Satu-satunya definisi "run sedang berjalan" (SPEC-142). `queued` wajib ikut: setiap
// run lahir queued, dan gate poll yang melewatkannya membuat daftar run membeku sampai
// operator refresh manual. Param `string` (bukan z.infer<typeof zRunStatus>) karena
// zRunSummary.status di dto.ts adalah z.string(); status tak dikenal → false.
// Beda dari "punya proses hidup" (running|awaiting|paused, untuk steer/pause/stop) dan dari
// "boleh di-enqueue" (queued|running|awaiting, dedupe di server/src/queue.ts). `awaiting`
// (SPEC-157) = proses claude hidup, terblokir menunggu keputusan manusia.
export const isRunActive = (status: string): boolean =>
  status === "queued" || status === "running" || status === "awaiting" || status === "paused";
