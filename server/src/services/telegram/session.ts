import { createHash } from "node:crypto";
import type { Agent } from "@hanoman/shared";
import { buildTelegramOperatorPrompt } from "@hanoman/runner";
import type { AcceptedTelegramInput } from "./protocol";
import type { TelegramStore } from "./store";

type SessionRef = { id: string; exited: boolean };
type SessionCreateOptions = {
  id: string;
  prompt: string;
  agent: Agent;
  model: string;
  effort: string;
  env: Record<string, string>;
};

export type TelegramSessionPort = {
  getSession(id: string): SessionRef | undefined;
  createSession(projectId: string, cwd: string, opts: SessionCreateOptions): SessionRef;
  sendToPane(id: string, text: string): Promise<boolean>;
};

type Personality = { name: string; description: string; instructions: string };

export type TelegramSessionCoordinatorDeps = {
  store: TelegramStore;
  port: TelegramSessionPort;
  defaults(): Promise<{ agent: Agent; model: string; effort: string }>;
  personality(id: string | null, projectId: string | null): Promise<Personality | null>;
  ensureCodexTrust(cwd: string): void;
  home: string;
  apiBase: string;
  agentToken: string;
  ensureDir(path: string): void;
};

const chatHash = (chatId: string): string => createHash("sha256").update(chatId).digest("hex").slice(0, 16);
export const telegramOperatorSessionId = (chatId: string): string => `telegram-${chatHash(chatId)}`;
export const formatTelegramTurn = (input: AcceptedTelegramInput): string =>
  `[Telegram update ${input.updateId} · chat ${input.chatId} · kind ${input.kind}]\n${input.text}`;

export class TelegramSessionCoordinator {
  constructor(private readonly deps: TelegramSessionCoordinatorDeps) {}

  async dispatch(input: AcceptedTelegramInput): Promise<{ sessionId: string; created: boolean }> {
    let context = await this.deps.store.chatContext(input.chatId);
    if (!context) {
      const defaults = await this.deps.defaults();
      await this.deps.store.ensureChat({
        chatId: input.chatId,
        userId: input.userId,
        agent: defaults.agent,
        model: defaults.model,
        effort: defaults.effort,
      });
      context = await this.deps.store.chatContext(input.chatId);
    }
    if (!context) throw new Error("gagal membuat binding chat Telegram");

    const sessionId = telegramOperatorSessionId(input.chatId);
    const live = this.deps.port.getSession(sessionId);
    if (live && !live.exited) {
      if (!await this.deps.port.sendToPane(sessionId, formatTelegramTurn(input))) {
        throw new Error("pane operator tidak menerima steer");
      }
      if (context.sessionId !== sessionId) await this.deps.store.bindSession(input.chatId, sessionId);
      return { sessionId, created: false };
    }

    const hash = chatHash(input.chatId);
    const projectId = `telegram:${hash}`;
    const cwd = `${this.deps.home.replace(/\/$/, "")}/telegram/${hash}`;
    this.deps.ensureDir(cwd);
    if (context.agent === "codex") this.deps.ensureCodexTrust(cwd);
    const personality = await this.deps.personality(context.personalityAgentId, context.activeProjectId);
    const prompt = buildTelegramOperatorPrompt({
      update: input,
      personality,
      summary: context.summary,
      memories: context.memories,
    });
    const born = this.deps.port.createSession(projectId, cwd, {
      id: sessionId,
      prompt,
      agent: context.agent,
      model: context.model,
      effort: context.effort,
      env: {
        HANOMAN_API_BASE: this.deps.apiBase,
        HANOMAN_TELEGRAM_AGENT_TOKEN: this.deps.agentToken,
        HANOMAN_TELEGRAM_CHAT_ID: input.chatId,
      },
    });
    if (born.id !== sessionId || born.exited) throw new Error("pane operator gagal lahir");
    await this.deps.store.bindSession(input.chatId, sessionId);
    return { sessionId, created: true };
  }
}
