import { prisma } from "../db";
import { zSetting, type Setting } from "@hanoman/shared";
import { resolvePhaseModels, type PhaseModel, type Flow } from "@hanoman/runner";

// Model id + effort yang diteruskan apa adanya ke `claude --model` / `--effort`.
const STEP = { model: "claude-opus-4-8", effort: "xhigh" };
// DB yang masih segar belum punya baris Setting (ia lahir di PUT /settings pertama). Default
// ini menjaga API tetap boot alih-alih melempar P2025.
export const DEFAULT_SETTING: Setting = {
  ...STEP,
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert",
  phaseModels: {},                                                          // SPEC-238 · ADR-0057
};

// Baris Setting adalah `Json` bebas bentuk, dan baris yang ditulis SEBELUM SPEC-162 masih
// menyimpan `steps`/`maxConcurrent`/`askTimeoutMin` tanpa `model` maupun `effort`. Dikembalikan
// mentah, `s.model` di UI menjadi undefined dan sesi lahir dengan `claude --model undefined`.
// `.parse` mengisi default untuk kunci yang hilang; bentuk yang benar-benar rusak jatuh ke
// DEFAULT_SETTING, bukan melempar dan membuat layar Settings kosong.
export async function getSetting(): Promise<Setting> {
  const raw = (await prisma.setting.findUnique({ where: { id: 1 } }))?.data;
  if (raw === undefined || raw === null) return DEFAULT_SETTING;
  const parsed = zSetting.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SETTING;
}
/** SPEC-162 · model+effort untuk sesi claude interaktif, dipakai sebagai argv saat sesi lahir. */
export async function sessionModel(): Promise<{ model: string; effort: string }> {
  const { model, effort } = await getSetting();
  return { model, effort };
}

/** SPEC-238 · ADR-0057 · tabel model/effort per fase + fallback global untuk sebuah flow. */
export async function phaseModelsForFlow(flow: Flow): Promise<{
  fallback: { model: string; effort: string }; perPhase: PhaseModel[];
}> {
  const s = await getSetting();
  const fallback = { model: s.model, effort: s.effort };
  const { perPhase } = resolvePhaseModels(flow, s.phaseModels?.[flow], fallback);
  return { fallback, perPhase };
}
