import type { FastifyInstance } from "fastify";
import { zAgentTokenCreate, zAgentTokenPatch, CAPABILITIES } from "@hanoman/shared";
import { issueAgentToken, listAgentTokens, patchAgentToken, revokeAgentToken } from "../services/agent-token";

// SPEC-257 · ADR-0065 · kelola agent token dari dashboard (cookie-only, warisan gate + peta COOKIE_ONLY).
// Plaintext token hanya balik di POST (sekali). List & patch tak pernah membuka rahasia.
export default async function (app: FastifyInstance) {
  // Static route sebelum "/:id" agar tak ketangkap param.
  app.get("/agent-tokens/capabilities", async () => ({ capabilities: CAPABILITIES }));

  app.get("/agent-tokens", async () => ({ items: await listAgentTokens() }));

  app.post("/agent-tokens", async (req, reply) => {
    const p = zAgentTokenCreate.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const { view, token } = await issueAgentToken({ ...p.data, createdBy: req.user?.id });
    return reply.code(201).send({ ...view, token });
  });

  app.patch("/agent-tokens/:id", async (req, reply) => {
    const p = zAgentTokenPatch.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const { id } = req.params as { id: string };
    const view = await patchAgentToken(id, p.data);
    return view ? reply.send(view) : reply.code(404).send({ error: "not found" });
  });

  app.delete("/agent-tokens/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return (await revokeAgentToken(id)) ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
  });
}
