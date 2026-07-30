import type { FastifyInstance } from "fastify";
import { zUpdateApplyBody } from "@hanoman/shared";
import { getUpdateStatus, requestRestartForUpdate } from "../services/update";
import { listSessions } from "../services/pty";

// GET /api/update — status auto-update (SPEC-214/398). Auth-gated otomatis (bukan anggota PUBLIC
// di app.ts). Realtime lewat WS siar grup "update".
//
// POST /api/update/apply — SPEC-405 · ADR-0088. Server TETAP tak memasang apa pun (ADR-0048 utuh
// di intinya): ia hanya keluar dengan kode sentinel, dan supervisor `hanoman start` yang memasang
// lalu menjalankan ulang. Karena itu ia HANYA sah saat proses ini punya supervisor.
export default async function update(app: FastifyInstance) {
  app.get("/update", async () => getUpdateStatus());

  app.post("/update/apply", async (req, reply) => {
    const parsed = zUpdateApplyBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "bad-body" });

    const u = await getUpdateStatus();
    if (!u.canApply) return reply.code(409).send({ error: "unsupervised" });
    if (!u.updateAvailable) return reply.code(409).send({ error: "up-to-date", current: u.currentVersion });

    // Dihitung SAAT INI, bukan diambil dari frame siar `update`: grup itu di-recompute tiap 300
    // tick, dan angka basi pada dialog risiko lebih buruk daripada tak ada angka.
    const liveSessions = listSessions().filter((s) => !s.exited).length;
    const from = u.currentVersion;
    const to = u.latestVersion;

    // Langkah pertama sengaja hanya MELAPOR. Sesi hidup tak memblokir apa pun di server —
    // manusia yang memutuskan, dan pane tmux memang selamat dari restart (ADR-0016).
    if (!parsed.data.confirm) return reply.code(409).send({ error: "confirm-required", liveSessions, from, to });

    requestRestartForUpdate();
    return reply.code(202).send({ accepted: true, from, to, liveSessions });
  });
}
