import { AsyncLocalStorage } from "node:async_hooks";
import { SYSTEM_ACTOR, type WebhookActor } from "@hanoman/shared";

// SPEC-481 · ADR-0100 · amplop menjanjikan SIAPA yang memicu, tapi identitas itu hanya hidup di
// request sementara tap berjalan di layer Prisma. AsyncLocalStorage menjembataninya tanpa mengoper
// argumen lewat setiap penulis. Di luar konteks mana pun jawabannya `system` — jujur, bukan tebakan.
const als = new AsyncLocalStorage<WebhookActor>();

export function currentActor(): WebhookActor {
  return als.getStore() ?? SYSTEM_ACTOR;
}

/** Untuk hook Fastify: `enterWith` menempel ke konteks async request yang sedang berjalan. */
export function setActor(a: WebhookActor): void {
  als.enterWith(a);
}

/** Untuk penulis latar yang punya identitas sendiri (mis. tindakan hanoman-lead). */
export function withActor<T>(a: WebhookActor, fn: () => Promise<T>): Promise<T> {
  return als.run(a, fn);
}

export function actorFromRequest(req: {
  user?: { id: string; email: string } | null;
  agent?: { id: string; name?: string } | null;
}): WebhookActor {
  if (req.user) return { kind: "user", id: req.user.id, label: req.user.email };
  // Label = nama token bila ada, kalau tidak id-nya. TIDAK PERNAH tokennya sendiri: amplop ini
  // keluar dari mesin ini. `req.agent` yang didekorasi gate auth memang hanya membawa
  // `{ id, capabilities }` (services/agent-auth.ts), jadi id-lah yang tersedia di jalur nyata.
  if (req.agent) return { kind: "agent", id: req.agent.id, label: req.agent.name ?? req.agent.id };
  return SYSTEM_ACTOR;
}
