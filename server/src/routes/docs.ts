import type { FastifyInstance } from "fastify";
import { zDocFileContent } from "@hanoman/shared";
import { docIndex, readDoc, writeDoc, deleteDoc } from "../services/docs";
import { listPrds, listAllPrds, readPrd } from "../services/project-prds";

export default async function (app: FastifyInstance) {
  app.get("/projects/:id/docs", async (req) => docIndex((req.params as { id: string }).id));

  // perbaikan SPEC-210 · daftar PRD lintas-project (filter "Semua project"), item bawa projectId/projectName.
  app.get("/prds", async () => ({ items: await listAllPrds() }));

  // SPEC-210 · daftar & preview dokumen PRD (freshest-wins: worktree sesi prd hidup > repoDir).
  app.get("/projects/:id/prds", async (req) =>
    ({ items: await listPrds((req.params as { id: string }).id) }));

  app.get("/projects/:id/prds/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const content = await readPrd(id, path);
    return content === null ? reply.code(404).send({ error: "not found" }) : { path, content };
  });

  app.get("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const content = await readDoc(id, path);
    return content === null ? reply.code(404).send({ error: "not found" }) : { path, content };
  });

  app.put("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const parsed = zDocFileContent.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await writeDoc(id, path, parsed.data.content);
      return { path, content: parsed.data.content };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete("/projects/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    try {
      const ok = await deleteDoc(id, path);
      return ok ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
