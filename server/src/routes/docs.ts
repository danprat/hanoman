import type { FastifyInstance } from "fastify";
import { zDocFileContent } from "@hanoman/shared";
import { docIndex, readDoc, writeDoc } from "../services/docs";
export default async function (app: FastifyInstance) {
  app.get("/projects/:id/docs", async (req) => docIndex((req.params as { id: string }).id));
  app.get("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string }; const path = (req.params as Record<string, string>)["*"] ?? "";
    const content = await readDoc(id, path);
    return content === null ? reply.code(404).send({ error: "not found" }) : { path, content };
  });
  app.put("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string }; const path = (req.params as Record<string, string>)["*"] ?? "";
    const parsed = zDocFileContent.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await writeDoc(id, path, parsed.data.content);
    return { path, content: parsed.data.content };
  });
}
