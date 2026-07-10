import type { FastifyInstance } from "fastify";
import { getLimits } from "../services/limits";

// GET /api/limits — auth-gated otomatis (bukan anggota PUBLIC di app.ts). Limit langganan Claude
// realtime; poll frontend tiap 60s, cache 30s di service. Lihat SPEC-181.
export default async function limits(app: FastifyInstance) {
  app.get("/limits", async () => getLimits());
}
