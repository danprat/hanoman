import { prisma } from "../db";
import { zSetting, SCHEDULER_DEFAULTS, type Setting } from "@hanoman/shared";

// Model id + effort yang diteruskan apa adanya ke `claude --model` / `--effort`.
const STEP = { model: "claude-opus-4-8", effort: "xhigh" };
// DB yang masih segar belum punya baris Setting (ia lahir di PUT /settings pertama). Default
// ini menjaga API tetap boot alih-alih melempar P2025.
export const DEFAULT_SETTING: Setting = {
  ...STEP,
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false,   // SPEC-257 · akses AI agent off sampai dibuka manusia
  scheduler: SCHEDULER_DEFAULTS,   // SPEC-294 · ADR-0072 · semua knob scheduler default mati
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
/**
 * SPEC-162 · model+effort DEFAULT untuk sesi claude interaktif, argv saat sesi lahir.
 * SPEC-252 · ADR-0061 · ini adalah default global; Start bisa meng-override per sesi.
 */
export async function sessionModel(): Promise<{ model: string; effort: string }> {
  const { model, effort } = await getSetting();
  return { model, effort };
}
