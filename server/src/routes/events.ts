import type { FastifyInstance } from "fastify";
import { attach, detach } from "../services/events";
import type { Client } from "../services/pty";

// SPEC-199 · WebSocket siar dashboard (ADR-0039). Auth diwarisi gate onRequest scope /api
// (cookie same-origin), sama seperti WS terminal. Read-only feed: frame masuk diabaikan.
export default async function (app: FastifyInstance) {
  app.get("/events/ws", { websocket: true }, (socket) => {
    const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
    void attach(client);
    socket.on("close", () => detach(client));
  });
}
