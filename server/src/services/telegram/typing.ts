import { TelegramApiError } from "./client";

/**
 * SPEC-493 · ADR-0104 · umur status typing Telegram ~5 detik dan TIDAK ada API stop-typing. Semua
 * angka di bawah turunan dari fakta itu: poll aktif harus di bawah 5 detik, dan menghentikan
 * indikator = berhenti me-refresh.
 */
export const TYPING_ACTIVE_POLL_SEC = 4;
/** Iterasi loop bisa berulang jauh lebih cepat dari 4 dtk saat update datang beruntun. */
export const TYPING_MIN_INTERVAL_MS = 3_000;
export const TYPING_COOLDOWN_BASE_MS = 5_000;
/** Pagar cooldown, cermin hermes `max(1.0, min(delay, 300.0))`. */
export const TYPING_COOLDOWN_MIN_MS = 1_000;
export const TYPING_COOLDOWN_MAX_MS = 300_000;
/** Umur maksimum sebuah update boleh menahan typing & long-poll pendek. 6× giliran terlama (95 dtk). */
export const TYPING_MAX_WAIT_MS = 600_000;

export const clampTypingCooldown = (ms: number): number =>
  Math.min(TYPING_COOLDOWN_MAX_MS, Math.max(TYPING_COOLDOWN_MIN_MS, Math.round(ms)));

/**
 * Long-poll adaptif: satu-satunya cara memberi denyut ~4 detik TANPA timer baru (ADR-0024).
 * `Math.min` menjaga pemanggil yang menyuntik `idle` kecil (test) tetap bermakna, dan hasilnya
 * tak pernah 0 selama `idle > 0` — `timeout: 0` adalah busy-poll yang dilarang.
 */
export const pollTimeoutFor = (waiting: number, idle: number): number =>
  waiting > 0 ? Math.min(TYPING_ACTIVE_POLL_SEC, idle) : idle;

export type TelegramTypingSender = {
  sendChatAction(chatId: string, action: "typing"): Promise<boolean>;
};

type ChatTypingState = { lastArmedAt: number; cooldownUntil: number; nextDelayMs: number };

/**
 * SPEC-493 · seluruh state typing hidup DI SINI dan hanya di memori: ia kosmetik, jadi ia tak
 * berhak menyentuh jalur at-most-once update/outbox. Konsekuensi yang disengaja — tak satu pun
 * method di kelas ini bisa melempar.
 */
export class TelegramTypingIndicator {
  private readonly state = new Map<string, ChatTypingState>();
  private readonly now: () => number;

  constructor(private readonly deps: {
    client: TelegramTypingSender;
    /** `Setting.telegram.progress`. Mati = benar-benar senyap: nol panggilan API. */
    enabled: boolean;
    now?: () => number;
  }) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Paksa — MENGABAIKAN throttle. Telegram menghapus status typing tiap ada pesan masuk. */
  async arm(chatId: string): Promise<void> {
    await this.send(chatId, true);
  }

  /** Denyut loop; ter-throttle supaya iterasi cepat beruntun tak jadi banjir panggilan API. */
  async refresh(chatIds: readonly string[]): Promise<void> {
    for (const chatId of chatIds) await this.send(chatId, false);
    this.prune(new Set(chatIds));
  }

  private async send(chatId: string, force: boolean): Promise<void> {
    if (!this.deps.enabled) return;
    const now = this.now();
    const current = this.state.get(chatId);
    if (current && now < current.cooldownUntil) return;
    if (!force && current && now - current.lastArmedAt < TYPING_MIN_INTERVAL_MS) return;
    try {
      await this.deps.client.sendChatAction(chatId, "typing");
      this.state.set(chatId, { lastArmedAt: now, cooldownUntil: 0, nextDelayMs: TYPING_COOLDOWN_BASE_MS });
    } catch (error) {
      // Kegagalan permanen (403 diblokir, 400 chat hilang) ikut jalur yang sama dan mengendap di
      // 300 dtk. Membedakannya dari transien hanya menambah cabang tanpa mengubah keluaran.
      const retryAfterMs = error instanceof TelegramApiError
        && typeof error.retryAfter === "number" && error.retryAfter > 0
        ? error.retryAfter * 1_000
        : null;
      const delay = clampTypingCooldown(retryAfterMs ?? current?.nextDelayMs ?? TYPING_COOLDOWN_BASE_MS);
      this.state.set(chatId, {
        lastArmedAt: current?.lastArmedAt ?? 0,
        cooldownUntil: now + delay,
        nextDelayMs: clampTypingCooldown(delay * 2),
      });
    }
  }

  /** Chat yang sudah lama tak aktif dan tak sedang di-cooldown dibuang agar peta tak tumbuh. */
  private prune(active: ReadonlySet<string>): void {
    const now = this.now();
    for (const [chatId, entry] of this.state) {
      if (active.has(chatId)) continue;
      if (now < entry.cooldownUntil) continue;
      if (now - entry.lastArmedAt <= TYPING_MAX_WAIT_MS) continue;
      this.state.delete(chatId);
    }
  }
}
