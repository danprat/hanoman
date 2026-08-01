import {
  configEntry, maskSecret, parseConfigValue, TELEGRAM_CONFIG_KEYS, type TelegramConfigKey,
} from "@hanoman/shared";
import { clearConfig, effectiveStr, setConfig, sourceOf } from "../../config";
import { TelegramApiClient, type TelegramTransport } from "./client";
import { sanitizeTelegramOutput } from "./protocol";

/**
 * SPEC-477 · ADR-0097 · permukaan kredensial Telegram. Semua I/O lewat resolver config
 * (ADR-0049) dan port `transport`, sehingga berkas ini bisa dites tanpa server maupun jaringan.
 */
export type TelegramCredentialField = {
  key: TelegramConfigKey;
  label: string;
  help?: string;
  kind: "secret" | "string";
  source: "db" | "env" | "default";
  hasValue: boolean;
  masked?: string | null;   // hanya kind secret
  value?: string | null;    // hanya kind non-secret
};
export type TelegramCredentialsView = { fields: TelegramCredentialField[] };
export type TelegramTestResult =
  | { ok: true; botUsername: string | null; chatId: string }
  | { ok: false; error: string };

const KEYS = TELEGRAM_CONFIG_KEYS;

/** Bot token & AgentToken TAK PERNAH keluar utuh — hanya `masked` + `hasValue`. */
export function telegramCredentialView(): TelegramCredentialsView {
  return {
    fields: KEYS.map((key): TelegramCredentialField => {
      const entry = configEntry(key)!;
      const eff = effectiveStr(key);
      const base = {
        key, label: entry.label, help: entry.help,
        source: sourceOf(key), hasValue: eff !== undefined && eff !== "",
      };
      return entry.kind === "secret"
        ? { ...base, kind: "secret", masked: eff ? maskSecret(eff) : null }
        : { ...base, kind: "string", value: eff ?? null };
    }),
  };
}

/**
 * Secret dengan string kosong = PERTAHANKAN nilai lama (cermin `PUT /config`), sehingga form
 * bisa dikirim ulang tanpa mengetik ulang token. Validasi lewat `parseConfigValue` — satu jalur
 * dengan `PUT /config`, jadi tak ada dua definisi "token yang sah".
 */
export async function saveTelegramCredentials(
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; key: string; error: string }> {
  const writes: [TelegramConfigKey, string][] = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!(KEYS as readonly string[]).includes(key)) return { ok: false, key, error: "key bukan kredensial Telegram" };
    if (typeof raw !== "string") return { ok: false, key, error: "nilai harus string" };
    const entry = configEntry(key)!;
    if (raw.trim() === "") {
      if (entry.kind === "secret") continue;                       // pertahankan yang lama
      return { ok: false, key, error: "tak boleh kosong" };
    }
    const parsed = parseConfigValue(entry, raw);
    if (!parsed.ok) return { ok: false, key, error: parsed.error };
    writes.push([key as TelegramConfigKey, parsed.value]);
  }
  // Validasi SELURUH patch dulu, baru tulis: satu field salah tak boleh meninggalkan
  // separuh kredensial tersimpan.
  for (const [key, value] of writes) await setConfig(key, value);
  return { ok: true };
}

/**
 * Nilai `.env` lama, bila ada, akan dipakai KEMBALI oleh resolver sesudah baris DB dihapus —
 * itu memang semantik ADR-0049. Dilaporkan eksplisit supaya tak jadi kejutan diam.
 */
export async function clearTelegramCredentials(): Promise<{ cleared: string[]; envFallback: string[] }> {
  const cleared: string[] = [];
  for (const key of KEYS) {
    if (sourceOf(key) === "db") { await clearConfig(key); cleared.push(key); }
  }
  return { cleared, envFallback: KEYS.filter((k) => sourceOf(k) === "env") };
}

export type TestConnectionDeps = {
  botToken?: string;
  chatId?: string;
  transport?: TelegramTransport;
  timeoutMs?: number;
  now?: () => Date;
};

/**
 * Klien SEKALI PAKAI — bukan klien gateway yang sedang long-poll. Klien itu memegang
 * `AbortController` loop-nya; menumpang di sana menukar "uji koneksi" dengan "putuskan polling".
 */
export async function testTelegramConnection(deps: TestConnectionDeps = {}): Promise<TelegramTestResult> {
  const botToken = deps.botToken ?? effectiveStr("HANOMAN_TELEGRAM_BOT_TOKEN");
  if (!botToken) return { ok: false, error: "Bot token belum diisi." };
  const chatId = deps.chatId ?? resolveTestChatId();
  if (!chatId) {
    return { ok: false, error: "Isi Chat / Channel ID target — atau isi allowlist dengan tepat satu user id." };
  }
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const send = deps.transport ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const transport: TelegramTransport = (url, init) => send(url, { ...init, signal: controller.signal });
  const client = new TelegramApiClient(botToken, transport);
  try {
    const me = await client.getMe();
    const stamp = (deps.now?.() ?? new Date()).toISOString();
    await client.sendMessage({ chatId, text: `hanoman: uji koneksi Telegram berhasil (${stamp}).` });
    return { ok: true, botUsername: me.username ?? null, chatId };
  } catch (error) {
    const raw = (error as Error).message || "gagal menghubungi Telegram";
    const message = controller.signal.aborted ? `Timeout ${timeoutMs} ms — Telegram tidak menjawab.` : raw;
    // Lapis kedua di atas `TelegramApiClient.safe()`: token & pola credential dibuang total.
    return { ok: false, error: sanitizeTelegramOutput(message, [botToken]).slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

/** Target = field khusus, atau — bila kosong — satu-satunya id di allowlist. */
function resolveTestChatId(): string | null {
  const target = effectiveStr("HANOMAN_TELEGRAM_TARGET_CHAT_ID")?.trim();
  if (target) return target;
  const ids = (effectiveStr("HANOMAN_TELEGRAM_ALLOWED_USER_IDS") ?? "").split(/[\s,]+/).filter(Boolean);
  return ids.length === 1 ? ids[0]! : null;
}
