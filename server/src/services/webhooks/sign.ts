import { createHmac } from "node:crypto";
import { WEBHOOK_HEADERS, WEBHOOK_USER_AGENT } from "@hanoman/shared";

// SPEC-481 · ADR-0100 · tanda tangan v1 = HMAC-SHA256 atas `<timestamp>.<raw body>`.
//
// Timestamp IKUT ditandatangani: tanpa itu penerima tak punya cara menolak replay — badan yang
// sama akan selamanya lolos verifikasi. Penerima diminta menolak selisih > WEBHOOK_TOLERANCE_SEC.
// Prefix `v1=` supaya rotasi algoritma kelak tak menuntut menebak.
export function signBody(secret: string, timestampSec: number, body: string): string {
  return "v1=" + createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex");
}

export function signedHeaders(o: {
  secret: string; body: string; eventType: string; eventId: string;
  deliveryId: string; attempt: number; nowSec: number;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": WEBHOOK_USER_AGENT,
    [WEBHOOK_HEADERS.event]: o.eventType,
    [WEBHOOK_HEADERS.eventId]: o.eventId,
    [WEBHOOK_HEADERS.delivery]: o.deliveryId,
    [WEBHOOK_HEADERS.attempt]: String(o.attempt),
    [WEBHOOK_HEADERS.timestamp]: String(o.nowSec),
    [WEBHOOK_HEADERS.signature]: signBody(o.secret, o.nowSec, o.body),
  };
}
