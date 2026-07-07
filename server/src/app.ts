import Fastify, { type FastifyInstance } from "fastify";
import health from "./routes/health";
import projects from "./routes/projects";
// route imports added by later tasks: specs, triggers, settings, docs, runs
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(async (api) => {
    await api.register(health);
    await api.register(projects);
    // await api.register(specs); ... (added in Tasks 11-14)
  }, { prefix: "/api" });
  return app;
}
