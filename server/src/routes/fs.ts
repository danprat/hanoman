import type { FastifyInstance } from "fastify";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";

// Local-tool directory browser. The dashboard runs in a browser, which cannot
// read an absolute filesystem path from a folder picker — so the server (same
// machine as the codebases) lists real sub-directories and hands back absolute
// paths for the "Existing codebase" flow.
// ponytail: browses the whole machine FS — fine for a localhost single-user
// tool. Gate behind an allow-root env if this ever binds to a network iface.
export default async function (app: FastifyInstance) {
  app.get("/fs/browse", async (req, reply) => {
    const q = (req.query as { path?: string }).path;
    const dir = q && q.trim() ? resolve(q.trim()) : homedir();
    try {
      const ents = await readdir(dir, { withFileTypes: true });
      const entries = ents
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => ({ name: e.name, path: join(dir, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parent = dirname(dir);
      return { path: dir, parent: parent === dir ? null : parent, entries };
    } catch {
      return reply.code(400).send({ error: `tak bisa membaca folder "${dir}"` });
    }
  });
}
