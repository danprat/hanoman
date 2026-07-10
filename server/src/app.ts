import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import health from "./routes/health";
import projects from "./routes/projects";
import specs from "./routes/specs";
import settings from "./routes/settings";
import docs from "./routes/docs";
import fs from "./routes/fs";
import terminal from "./routes/terminal";
import vps from "./routes/vps";
import { detachAll } from "./services/pty";
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  // POST tanpa body masih boleh membawa content-type JSON; parser bawaan Fastify menjawab
  // 400 untuk body kosong. Perlakukan kosong sebagai undefined, sementara body sungguhan
  // tetap diparse.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (!body) return done(null, undefined);
    try { done(null, JSON.parse(body as string)); }
    catch (err) { (err as Error & { statusCode?: number }).statusCode = 400; done(err as Error, undefined); }
  });
  // fastify-plugin'd, jadi dekoratornya menurun ke scope /api di bawah.
  app.register(websocket);
  // Lepaskan klien tmux (PTY yatim menahan proses tetap hidup), tapi JANGAN bunuh sesinya:
  // claude yang sedang bekerja harus selamat dari restart server (ADR-0016).
  app.addHook("onClose", async () => { detachAll(); });
  app.register(async (api) => {
    await api.register(health);
    await api.register(projects);
    await api.register(specs);
    await api.register(settings);
    await api.register(docs);
    await api.register(fs);
    await api.register(terminal);
    await api.register(vps);
  }, { prefix: "/api" });

  // Prod: serve the built dashboard from one process; SPA-fallback to
  // index.html for non-/api routes (api 404s stay JSON, never a fake page).
  if (process.env.NODE_ENV === "production") {
    const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/dist");
    app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html"));
  }
  return app;
}
