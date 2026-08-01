import { randomBytes } from "node:crypto";
import { matchesEvent, type WebhookEndpointView } from "@hanoman/shared";
import { prisma } from "../../db";
import { decryptSecret, encryptSecret } from "../secret-box";

// SPEC-481 · ADR-0100 · daftar endpoint aktif dipegang di MEMORI dan disegarkan tiap mutasi.
// Alasannya bukan kecepatan query melainkan gerbang tap: `webhooksActive()` dibaca pada SETIAP
// tulisan Prisma, dan default hanoman adalah nol endpoint. Cache sinkron (cermin katalog custom
// agent ADR-0094) karena tap tak boleh menunggu Prisma untuk memutuskan "tak ada apa-apa di sini".

export type EndpointRow = {
  id: string; name: string; url: string; secret: string;
  events: unknown; projectIds: unknown;
  enabled: boolean; allowPrivate: boolean; apiVersion: number; maxPerMinute: number;
  disabledAt: Date | null; disabledReason: string | null;
  lastSuccessAt: Date | null; lastFailureAt: Date | null; failureStreak: number;
  createdAt: Date; updatedAt: Date;
};

/** Bentuk yang sudah dinormalkan untuk pemakai. Kolom `Json` dibaca defensif. */
export type Endpoint = Omit<EndpointRow, "events" | "projectIds"> & {
  events: string[]; projectIds: string[] | null;
};

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

export const normalize = (r: EndpointRow): Endpoint => ({
  ...r,
  events: strings(r.events),
  projectIds: Array.isArray(r.projectIds) ? strings(r.projectIds) : null,
});

let cache: Endpoint[] = [];

export function webhooksActive(): boolean { return cache.length > 0; }
export function activeEndpoints(): Endpoint[] { return cache; }

/** Wajib dipanggil tiap mutasi endpoint & sekali saat boot — perubahan berlaku tanpa restart. */
export async function refreshWebhookCache(): Promise<void> {
  try {
    const rows = await prisma.webhookEndpoint.findMany({ where: { enabled: true } });
    cache = (rows as unknown as EndpointRow[]).map(normalize);
  } catch {
    // DB kedip tak boleh menjatuhkan jalur tulis; daftar kosong = tap diam (degradasi yang benar).
    cache = [];
  }
}

/** `projectId` null = peristiwa tanpa project → hanya endpoint tanpa filter project yang cocok. */
export function matchingEndpoints(eventType: string, projectId: string | null): Endpoint[] {
  return cache.filter((e) => {
    if (!matchesEvent(e.events, eventType)) return false;
    if (e.projectIds === null) return true;
    return projectId !== null && e.projectIds.includes(projectId);
  });
}

/** 32 byte acak base64url — sama kelasnya dengan token perangkat & agent token. */
export const newSecret = (): string => randomBytes(32).toString("base64url");

export const encryptEndpointSecret = (plain: string): string => encryptSecret(plain);

/** `null` = ciphertext tak bisa dibuka (kunci berganti) → pengiriman gagal dengan alasan jelas. */
export const secretOf = (row: { secret: string }): string | null => decryptSecret(row.secret);

export function endpointView(r: EndpointRow, pending: number, plainSecret?: string): WebhookEndpointView {
  const n = normalize(r);
  const plain = plainSecret ?? secretOf(r);
  return {
    id: n.id, name: n.name, url: n.url, events: n.events, projectIds: n.projectIds,
    enabled: n.enabled, allowPrivate: n.allowPrivate, apiVersion: n.apiVersion,
    maxPerMinute: n.maxPerMinute,
    // Empat karakter terakhir cukup untuk mencocokkan dengan catatan operator, tak cukup untuk
    // memalsukan tanda tangan. Secret utuh HANYA pada respons create/rotate.
    secretHint: plain ? plain.slice(-4) : "????",
    disabledAt: n.disabledAt?.toISOString() ?? null,
    disabledReason: n.disabledReason,
    lastSuccessAt: n.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: n.lastFailureAt?.toISOString() ?? null,
    failureStreak: n.failureStreak,
    pending,
    createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString(),
    ...(plainSecret ? { secret: plainSecret } : {}),
  };
}
