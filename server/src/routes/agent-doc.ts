// SPEC-489 · satu berkas, satu route. Naskah panduan AI agent disajikan MENTAH supaya agen bisa
// membacanya dengan HTTP client apa pun — bukan hanya lewat dashboard ber-JS. PUBLIC (didaftarkan
// di app.ts): isinya sudah publik di GitHub, dan menggerbanginya berarti agen yang capability-nya
// kurang menerima 403 pada dokumen yang justru menjelaskan arti 403 itu.
// Path naskah TIDAK diresolve di sini: `import.meta.url` berkas ini sedalam `server/src/routes`
// saat dev tapi `server/dist` sesudah dibundel esbuild — dua kedalaman berbeda. app.ts memegang
// satu-satunya titik yang kedalamannya invarian (cermin pickWebDir).
import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { AGENT_DOC_REL } from "../guide-file";

export default async function (app: FastifyInstance, opts: { file: string | null }) {
  app.get("/agent-integration.md", async (_req, reply) => {
    if (!opts.file)
      return reply.code(404).send({
        error: `dokumen panduan tak ada di instalasi ini (${AGENT_DOC_REL}) — pasang ulang paket hanoman atau set HANOMAN_AGENT_DOC`,
      });
    const text = await readFile(opts.file, "utf8");
    return reply.type("text/markdown; charset=utf-8").send(text);
  });
}
