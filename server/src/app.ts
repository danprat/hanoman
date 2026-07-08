import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import health from "./routes/health";
import projects from "./routes/projects";
import specs from "./routes/specs";
import triggers from "./routes/triggers";
import settings from "./routes/settings";
import docs from "./routes/docs";
import runs from "./routes/runs";
import webhooks from "./routes/webhooks";
import fs from "./routes/fs";
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  // Body-less POSTs (scan / advance / toggle) may still carry a JSON
  // content-type; Fastify's default parser 400s on an empty body. Treat
  // empty as undefined so those routes work, while real bodies still parse.
  // Also stash the raw string on `req.rawBody` so the GitHub webhook route can
  // verify the HMAC signature against the exact bytes GitHub signed.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as { rawBody?: string }).rawBody = body as string;
    if (!body) return done(null, undefined);
    try { done(null, JSON.parse(body as string)); }
    catch (err) { (err as Error & { statusCode?: number }).statusCode = 400; done(err as Error, undefined); }
  });
  app.register(async (api) => {
    await api.register(health);
    await api.register(projects);
    await api.register(specs);
    await api.register(triggers);
    await api.register(settings);
    await api.register(docs);
    await api.register(runs);
    await api.register(webhooks);
    await api.register(fs);
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
