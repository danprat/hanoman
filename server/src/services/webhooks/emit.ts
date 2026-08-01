import { randomUUID } from "node:crypto";
import {
  clampEnvelope, eventTypeFor, projectRow, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_QUEUE_CAP,
  WEBHOOK_SPEC_VERSION,
  type WebhookAction, type WebhookEntityDef, type WebhookEnvelope,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { currentActor } from "./actor";
import { matchingEndpoints, webhooksActive, type Endpoint } from "./endpoints";

// SPEC-481 · ADR-0099 · dari "sebuah baris berubah" menjadi "n baris antrean". Dipanggil
// fire-and-forget oleh tap: apa pun yang salah di sini TIDAK boleh menggagalkan tulisan yang
// memicunya — janji "endpoint lambat tak memperlambat hanoman" dimulai di titik ini.

export type EmitInput = {
  def: WebhookEntityDef;
  action: WebhookAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changed: string[];
  cascade?: Record<string, number>;
};

function skipped(def: WebhookEntityDef, row: Record<string, unknown> | null): boolean {
  if (!def.skipWhen || !row) return false;
  return row[def.skipWhen.field] === def.skipWhen.equals;
}

const rowId = (i: EmitInput): string => String((i.after ?? i.before ?? {}).id ?? "");

export function projectIdOf(i: EmitInput): string | null {
  const f = i.def.projectIdField;
  if (!f) return null;
  const v = (i.after ?? i.before ?? {})[f];
  return typeof v === "string" && v ? v : null;
}

/** `null` = tak ada peristiwa untuk keadaan ini (aksi tak berkatalog, atau baris di-skip). */
export function buildEnvelope(
  i: EmitInput, projectName: string | null, nowIso: string, eventId: string,
): WebhookEnvelope | null {
  if (skipped(i.def, i.after) || skipped(i.def, i.before)) return null;
  const type = eventTypeFor(i.def, i.action, i.changed);
  if (!type) return null;
  const projectId = projectIdOf(i);
  return clampEnvelope({
    specVersion: WEBHOOK_SPEC_VERSION,
    id: eventId,
    type,
    createdAt: nowIso,
    project: projectId ? { id: projectId, name: projectName ?? projectId } : null,
    actor: currentActor(),
    data: {
      entity: i.def.entity,
      id: rowId(i),
      action: i.action,
      changed: i.changed,
      before: i.before ? projectRow(i.def, i.before) : null,
      after: i.after ? projectRow(i.def, i.after) : null,
      ...(i.cascade ? { cascade: i.cascade } : {}),
    },
    truncated: false,
    truncatedFields: [],
  });
}

export async function enqueueEnvelope(env: WebhookEnvelope, endpoints: Endpoint[]): Promise<void> {
  for (const e of endpoints) {
    // Cap per endpoint. Penerima yang mati berhari-hari tak boleh menumbuhkan tabel tanpa batas,
    // tapi kehilangan peristiwa juga tak boleh SENYAP — karena itu barisnya tetap lahir, sebagai
    // `dropped` yang terbaca di riwayat.
    const pending = await prisma.webhookDelivery.count({
      where: { endpointId: e.id, status: { in: ["pending", "sending"] } },
    });
    const full = pending >= WEBHOOK_QUEUE_CAP;
    await prisma.webhookDelivery.create({
      data: {
        endpointId: e.id, eventId: env.id, eventType: env.type,
        projectId: env.project?.id ?? null, payload: env as never,
        status: full ? "dropped" : "pending",
        maxAttempts: WEBHOOK_MAX_ATTEMPTS,
        error: full ? `antrean penuh (${WEBHOOK_QUEUE_CAP}) — endpoint tak menerima pengiriman` : null,
      },
    });
  }
}

export async function emitWebhook(i: EmitInput): Promise<void> {
  try {
    if (!webhooksActive()) return;
    const projectId = projectIdOf(i);
    const type = eventTypeFor(i.def, i.action, i.changed);
    if (!type) return;
    const targets = matchingEndpoints(type, projectId);
    if (!targets.length) return;
    // Nama project dibaca SEKALI per peristiwa, bukan per endpoint. Gagal baca bukan alasan
    // membatalkan peristiwa — id-nya tetap benar.
    const name = projectId
      ? (await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }))?.name ?? null
      : null;
    const env = buildEnvelope(i, name, new Date().toISOString(), `evt_${randomUUID().replace(/-/g, "")}`);
    if (!env) return;
    await enqueueEnvelope(env, targets);
  } catch (e) {
    // Jalur tulis produk TIDAK boleh gagal karena webhook. Satu baris log, lalu diam.
    console.error("webhook emit:", e);
  }
}
