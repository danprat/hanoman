import type { FastifyInstance } from "fastify";
import { codexVersionInfo } from "../services/codex-version";

// GET /api/codex/version (SPEC-339) — versi codex CLI terpasang + minimum yang dibutuhkan trio
// GPT-5.6. Murni observabilitas untuk peringatan lunak di UI: TIDAK memblokir kelahiran sesi
// (ADR-0037 — agen dipercaya, isolasi lewat worktree).
export default async function codex(app: FastifyInstance) {
  app.get("/codex/version", async () => codexVersionInfo());
}
