import { z } from "zod";
export const zStage = z.enum(["brainstorming","objective","spec-ready","planned","executing","done"]);
export const zSpecSource = z.enum(["brief","qa","audit","cross-audit","help"]);  // SPEC-253 · +help (tiket → backlog) · SPEC-337 · +cross-audit
export const zDocStatus = z.enum(["ok","drift","broken"]);
export const zPriority = z.enum(["tinggi","sedang","rendah"]);
export const zProjectKind = z.enum(["from-scratch","existing"]);
// SPEC-338 · ADR-0074 · mesin sesi. claude = Claude Code (default & historis), codex = Codex CLI.
export const zAgent = z.enum(["claude", "codex"]);
export const zSeverity = z.enum(["critical","major","minor"]);
export const zErrorStatus = z.enum(["new","escalated","resolved"]);  // SPEC-249 · siklus status grup error
export const zTicketCategory = z.enum(["bug","fitur","pertanyaan","lainnya"]);  // SPEC-253 · kategori keluhan
export const zTicketStatus = z.enum(["new","accepted","rejected"]);  // SPEC-253 · status triase tiket
export const zLinkKind = z.enum(["api","sdk","data","event","lainnya"]);  // SPEC-337 · ADR-0075 · jenis relasi antar project
// SPEC-376 · ADR-0080 · scope verifikasi sesi. changed = uji hanya yang berubah (default —
// beberapa sesi berjalan bersamaan di satu mesin); full = perilaku lama (seluruh project).
// Cermin `VerifyScope` di @hanoman/runner (pola yang sama dipakai Flow/zFlow & Agent/zAgent):
// zod untuk validasi di batas HTTP, union TS untuk lapis runner.
export const VERIFY_SCOPES = ["changed", "full"] as const;
export const zVerifyScope = z.enum(VERIFY_SCOPES);
export type VerifyScope = (typeof VERIFY_SCOPES)[number];
