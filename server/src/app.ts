import Fastify, { type FastifyInstance } from "fastify";
import health from "./routes/health";
// route imports added by later tasks: projects, specs, triggers, settings, docs, runs
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(async (api) => {
    await api.register(health);
    // await api.register(projects); ... (added in Tasks 10-14)
  }, { prefix: "/api" });
  return app;
}
