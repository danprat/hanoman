import type { FastifyInstance } from "fastify";
import { handleWebhook } from "../github/webhooks";

export default async function (app: FastifyInstance) {
  // Raw body is preserved by the app.ts content-type parser (`req.rawBody`) so
  // signature verification runs on the exact bytes GitHub signed.
  app.post("/webhooks/github", async (req, reply) => {
    const id = req.headers["x-github-delivery"] as string | undefined;
    const name = req.headers["x-github-event"] as string | undefined;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const payload = (req as { rawBody?: string }).rawBody;
    if (!id || !name || !signature || payload === undefined)
      return reply.code(400).send({ error: "missing webhook headers or body" });
    try {
      await handleWebhook({ id, name, signature, payload });
      return reply.code(200).send({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("signature does not match")) return reply.code(401).send({ error: "invalid signature" });
      console.error(`webhook ${name} ${id} failed`, err);
      return reply.code(500).send({ error: "webhook processing failed" });
    }
  });
}
