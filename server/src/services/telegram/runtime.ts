import type { TelegramGatewayStatus } from "@hanoman/shared";

export type TelegramRuntimeRegistration = {
  agentTokenId?: string | null;
  status?: TelegramGatewayStatus;
};

const stoppedStatus = (): TelegramGatewayStatus => ({
  configured: false,
  enabled: false,
  running: false,
  readiness: "disabled",
  botUsername: null,
  allowlistCount: 0,
  agentTokenConfigured: false,
  missingCapabilities: [],
  lastUpdateAt: null,
  lastError: null,
});

let registration: { agentTokenId: string | null; status: TelegramGatewayStatus } = {
  agentTokenId: null,
  status: stoppedStatus(),
};
let stopRuntime: (() => Promise<void>) | null = null;

export function setTelegramRuntime(input: TelegramRuntimeRegistration): void {
  registration = {
    agentTokenId: input.agentTokenId === undefined ? registration.agentTokenId : input.agentTokenId,
    status: input.status ?? registration.status,
  };
}

export function updateTelegramRuntimeStatus(patch: Partial<TelegramGatewayStatus>): void {
  registration = { ...registration, status: { ...registration.status, ...patch } };
}

export function telegramRuntimeStatus(): TelegramGatewayStatus {
  return { ...registration.status };
}

export function telegramGatewayAgentTokenId(): string | null {
  return registration.agentTokenId;
}

export function clearTelegramRuntime(): void {
  registration = { agentTokenId: null, status: stoppedStatus() };
  stopRuntime = null;
}

export function registerTelegramRuntimeStop(stop: (() => Promise<void>) | null): void {
  stopRuntime = stop;
}

export async function stopTelegramRuntime(): Promise<void> {
  const stop = stopRuntime;
  stopRuntime = null;
  if (stop) await stop();
}
