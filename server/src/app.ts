import Fastify, { type FastifyInstance } from "fastify";
import health from "./routes/health";
import projects from "./routes/projects";
import specs from "./routes/specs";
// route imports added by later tasks: triggers, settings, docs, runs
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(async (api) => {
    await api.register(health);
    await api.register(projects);
    await api.register(specs);
    // await api.register(triggers); ... (added in Tasks 12-14)
  }, { prefix: "/api" });
  return app;
}
