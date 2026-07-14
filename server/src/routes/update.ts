import type { FastifyInstance } from "fastify";
import { getUpdateStatus } from "../services/update";

// GET /api/update — status auto-update (SPEC-214). Read-only: server tak pernah pull/build/restart
// (ADR-0043). Auth-gated otomatis (bukan anggota PUBLIC di app.ts). Realtime lewat WS siar grup "update".
export default async function update(app: FastifyInstance) {
  app.get("/update", async () => getUpdateStatus());
}
