import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./SettingsScreen";
import { CODEX_DEFAULTS, CONFLICT_DEFAULTS, GOAL_DEFAULTS, LEAD_DEFAULTS, SCHEDULER_DEFAULTS, TELEGRAM_DEFAULTS } from "@hanoman/shared";

const setting = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true,
  notifyDecisionSound: "alert", agentAccessEnabled: true, scheduler: SCHEDULER_DEFAULTS,
  goal: GOAL_DEFAULTS, agent: "claude", codex: CODEX_DEFAULTS, verifyScope: "changed",
  conflict: CONFLICT_DEFAULTS, lead: LEAD_DEFAULTS, telegram: TELEGRAM_DEFAULTS,
};
const status = {
  configured: true, enabled: false, running: false, readiness: "ready", botUsername: "hanoman_bot",
  allowlistCount: 1, agentTokenConfigured: true, missingCapabilities: [], lastUpdateAt: null, lastError: null,
};

function json(value: unknown, statusCode = 200) {
  return Promise.resolve({ ok: statusCode < 400, status: statusCode, json: async () => value } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("SettingsScreen Telegram onboarding (SPEC-476)", () => {
  it("shows readiness and env-only onboarding without credential inputs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
      const path = String(url);
      if (path === "/api/settings" && init?.method === "PUT") return json({ ...setting, telegram: { enabled: true, progress: true } });
      if (path === "/api/settings") return json(setting);
      if (path === "/api/codex/version") return json({ version: null, minRequired: "0.0.0", ok: true });
      if (path === "/api/telegram/status") return json(status);
      throw new Error(`unexpected fetch ${path}`);
    });
    render(<SettingsScreen
      me={{ id: "u1", email: "dena@example.test", createdAt: "2026-08-01T00:00:00.000Z" }}
      onLoggedOut={() => {}}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Telegram" }));
    expect(await screen.findByText("Gateway Telegram")).toBeInTheDocument();
    expect(screen.getByText(/@hanoman_bot/)).toBeInTheDocument();
    expect(screen.getByText(/HANOMAN_TELEGRAM_BOT_TOKEN/)).toBeInTheDocument();
    expect(screen.getByText(/credential disimpan di env/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /token/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ method: "PUT" })));
  });
});
