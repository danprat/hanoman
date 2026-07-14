import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import cookie from "@fastify/cookie";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import health from "./routes/health";
import projects from "./routes/projects";
import specs from "./routes/specs";
import notifications from "./routes/notifications";
import settings from "./routes/settings";
import docs from "./routes/docs";
import ide from "./routes/ide";
import fs from "./routes/fs";
import terminal from "./routes/terminal";
import vps from "./routes/vps";
import limits from "./routes/limits";
import events from "./routes/events";
import deviceTokens from "./routes/device-tokens";
import bindings from "./routes/bindings";
import sync from "./routes/sync";
import sessionResults from "./routes/session-results";
import authRoutes from "./routes/auth";
import { COOKIE_NAME, lookupSession } from "./services/auth";
import { detachAll } from "./services/pty";

// Endpoint yang boleh diakses tanpa sesi (path lengkap termasuk prefix /api).
const PUBLIC = new Set([
  "GET /api/health",
  "GET /api/auth/status",
  "POST /api/auth/login",
  "POST /api/auth/setup",
]);

// requireAuth default true: prod (server.ts) selalu tergerbang. Test route yang tak
// menguji auth mem-build dgn { requireAuth: false } untuk melewati gate.
export function buildApp({ requireAuth = true }: { requireAuth?: boolean } = {}): FastifyInstance {
  // trustProxy: deploy resmi bind 127.0.0.1 di belakang reverse proxy (server.ts), jadi req.ip
  // default = IP proxy untuk SEMUA request. trustProxy membuat req.ip membaca X-Forwarded-For →
  // throttle login (services/auth.ts) jadi per-klien, bukan satu bucket global (SPEC-197).
  const app = Fastify({ logger: false, trustProxy: true });
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
    // Cookie parser lebih dulu supaya req.cookies terisi sebelum gate berjalan.
    await api.register(cookie);
    if (requireAuth) {
      api.addHook("onRequest", async (req, reply) => {
        // Isi req.user best-effort dulu (juga untuk endpoint publik spt /auth/status
        // yang ingin tahu siapa pemanggilnya), baru gerbang route non-publik.
        const token = req.cookies?.[COOKIE_NAME];
        const user = token ? await lookupSession(token) : null;
        if (user) req.user = user;
        const path = req.url.split("?")[0] ?? req.url;
        if (PUBLIC.has(`${req.method} ${path}`)) return;
        // SPEC-213 · ADR-0044/0046 · surface sync mesin-ke-mesin di-bypass gate cookie; tiap
        // route /api/sync di-enforce device token (Bearer / ?token= pada upgrade WS) sendiri.
        if (path.startsWith("/api/sync")) return;
        if (!user) return reply.code(401).send({ error: "unauthorized" });
      });
    }
    await api.register(authRoutes);
    await api.register(health);
    await api.register(projects);
    await api.register(specs);
    await api.register(notifications);
    await api.register(settings);
    await api.register(docs);
    await api.register(ide);
    await api.register(fs);
    await api.register(terminal);
    await api.register(vps);
    await api.register(limits);
    await api.register(events);
    await api.register(deviceTokens);
    await api.register(bindings);
    await api.register(sync);
    await api.register(sessionResults);
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
