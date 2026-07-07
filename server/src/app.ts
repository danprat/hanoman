import Fastify, { type FastifyInstance } from "fastify";
import health from "./routes/health";
import projects from "./routes/projects";
import specs from "./routes/specs";
import triggers from "./routes/triggers";
import settings from "./routes/settings";
import docs from "./routes/docs";
import runs from "./routes/runs";
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(async (api) => {
    await api.register(health);
    await api.register(projects);
    await api.register(specs);
    await api.register(triggers);
    await api.register(settings);
    await api.register(docs);
    await api.register(runs);
  }, { prefix: "/api" });
  return app;
}
