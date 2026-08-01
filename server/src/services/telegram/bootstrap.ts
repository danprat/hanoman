import type { FastifyInstance } from "fastify";
import { mkdirSync } from "node:fs";
import { resolveHome } from "@hanoman/runner";
import type { Setting } from "@hanoman/shared";
import { prisma } from "../../db";
import { verifyAgentToken as verifyAgentTokenReal } from "../agent-token";
import { ensureCodexTrust } from "../codex-trust";
import { getSetting as getSettingReal, sessionAgentDefaults } from "../settings";
import { createSession, getSession, sendToPane } from "../pty";
import { TelegramApiClient } from "./client";
import { TelegramGateway } from "./gateway";
import { TelegramSessionCoordinator } from "./session";
import { TelegramStore } from "./store";
import { registerTelegramRuntimeStop, setTelegramRuntime } from "./runtime";

export const TELEGRAM_REQUIRED_CAPABILITIES = [
  "projects:read", "projects:write", "backlog:read", "backlog:write",
  "sessions:read", "sessions:write", "docs:read", "docs:write",
  "ide:read", "ide:write", "vps:read", "vps:write",
  "settings:read", "settings:write", "support:read", "support:write",
  "notifications:read", "notifications:write", "lead:read", "lead:write",
  "agents:read", "telegram:read", "telegram:write",
] as const;

type RuntimeAgent = { id: string; capabilities: string[] };
type GatewayLifecycle = { start(): Promise<void>; stop(): Promise<void> };

export type TelegramGatewayFactoryInput = {
  apiBase: string;
  botToken: string;
  agentToken: string;
  allowedUserIds: ReadonlySet<string>;
  progress: boolean;
};
export type TelegramGatewayFactory = (input: TelegramGatewayFactoryInput) => Promise<{
  gateway: GatewayLifecycle;
  botUsername: string | null;
}>;

type BootstrapOptions = {
  apiBase: string;
  env?: Record<string, string | undefined>;
  getSetting?: () => Promise<Setting>;
  verifyAgentToken?: (token: string) => Promise<RuntimeAgent | null>;
  factory?: TelegramGatewayFactory;
};

export function parseTelegramAllowedUserIds(raw: string): Set<string> {
  const ids = raw.split(/[\s,]+/).filter(Boolean);
  if (!ids.length) throw new Error("Telegram allowlist wajib berisi numeric user id");
  if (ids.some((id) => !/^\d+$/.test(id))) throw new Error("Telegram allowlist hanya menerima numeric user id");
  return new Set(ids);
}

const configuredFrom = (env: Record<string, string | undefined>): boolean =>
  Boolean(env.HANOMAN_TELEGRAM_BOT_TOKEN?.trim()
    && env.HANOMAN_TELEGRAM_ALLOWED_USER_IDS?.trim()
    && env.HANOMAN_TELEGRAM_AGENT_TOKEN?.trim());

async function productionFactory(input: TelegramGatewayFactoryInput) {
  const client = new TelegramApiClient(input.botToken);
  const me = await client.getMe();
  const store = new TelegramStore(prisma);
  const coordinator = new TelegramSessionCoordinator({
    store,
    port: { getSession, createSession, sendToPane },
    defaults: sessionAgentDefaults,
    personality: async (id, projectId) => {
      if (!id) return null;
      const row = await prisma.customAgent.findUnique({ where: { id } });
      if (!row?.enabled || (row.projectId !== null && row.projectId !== projectId)) return null;
      return { name: row.name, description: row.description, instructions: row.instructions };
    },
    ensureCodexTrust,
    home: resolveHome(),
    apiBase: input.apiBase,
    agentToken: input.agentToken,
    ensureDir: (path) => mkdirSync(path, { recursive: true }),
  });
  const gateway = new TelegramGateway({
    client,
    store,
    dispatcher: coordinator,
    allowedUserIds: input.allowedUserIds,
    rateLimit: { limit: 20, windowMs: 60_000 },
    exactSecrets: [input.botToken, input.agentToken],
    progress: input.progress,
  });
  return { gateway, botUsername: me.username ?? null };
}

/** Dipanggil dari server.ts sesudah listen, custom-agent cache, dan history hook siap. */
export async function installTelegramGateway(_app: FastifyInstance, options: BootstrapOptions): Promise<void> {
  const env = options.env ?? process.env;
  const setting = await (options.getSetting ?? getSettingReal)();
  const configured = configuredFrom(env);
  const base = {
    configured,
    enabled: setting.telegram.enabled,
    running: false,
    botUsername: null,
    allowlistCount: 0,
    agentTokenConfigured: Boolean(env.HANOMAN_TELEGRAM_AGENT_TOKEN?.trim()),
    missingCapabilities: [] as string[],
    lastUpdateAt: null,
    lastError: null,
  };
  if (!setting.telegram.enabled) {
    setTelegramRuntime({ status: { ...base, readiness: "disabled" } });
    return;
  }
  if (!configured) {
    setTelegramRuntime({ status: { ...base, readiness: "misconfigured", lastError: "environment Telegram belum lengkap" } });
    return;
  }

  let allowedUserIds: Set<string>;
  try {
    allowedUserIds = parseTelegramAllowedUserIds(env.HANOMAN_TELEGRAM_ALLOWED_USER_IDS!);
  } catch (error) {
    setTelegramRuntime({ status: { ...base, readiness: "misconfigured", lastError: (error as Error).message } });
    return;
  }
  const verify = options.verifyAgentToken ?? verifyAgentTokenReal;
  const agent = setting.agentAccessEnabled ? await verify(env.HANOMAN_TELEGRAM_AGENT_TOKEN!) : null;
  const missing = agent
    ? TELEGRAM_REQUIRED_CAPABILITIES.filter((capability) => !agent.capabilities.includes(capability))
    : [...TELEGRAM_REQUIRED_CAPABILITIES];
  if (!agent || missing.length) {
    setTelegramRuntime({
      agentTokenId: agent?.id ?? null,
      status: {
        ...base,
        allowlistCount: allowedUserIds.size,
        missingCapabilities: missing,
        readiness: "misconfigured",
        lastError: agent ? "capability AgentToken Telegram belum lengkap" : "AgentToken Telegram tidak valid atau akses agent mati",
      },
    });
    return;
  }

  try {
    const built = await (options.factory ?? productionFactory)({
      apiBase: options.apiBase,
      botToken: env.HANOMAN_TELEGRAM_BOT_TOKEN!,
      agentToken: env.HANOMAN_TELEGRAM_AGENT_TOKEN!,
      allowedUserIds,
      progress: setting.telegram.progress,
    });
    await built.gateway.start();
    setTelegramRuntime({
      agentTokenId: agent.id,
      status: {
        ...base,
        configured: true,
        enabled: true,
        running: true,
        readiness: "running",
        botUsername: built.botUsername,
        allowlistCount: allowedUserIds.size,
        missingCapabilities: [],
      },
    });
    registerTelegramRuntimeStop(() => built.gateway.stop());
  } catch {
    setTelegramRuntime({
      agentTokenId: agent.id,
      status: {
        ...base,
        allowlistCount: allowedUserIds.size,
        readiness: "error",
        lastError: "gagal memverifikasi atau memulai Telegram Bot API",
      },
    });
  }
}
