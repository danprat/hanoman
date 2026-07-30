import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSemver, type UpdateStatus, type UpdateRegistryStatus } from "@hanoman/shared";
import { effectiveStr, effectiveBool } from "../config";

// SPEC-398 · ADR-0087 · hanoman didistribusikan sebagai paket npm global, jadi "ada update?" adalah
// perbandingan SEMVER dengan registry — bukan lagi `git fetch` + hitung commit (SPEC-214), yang tak
// punya arti apa pun di instalasi `npm i -g` (tak ada repo git di sana).
// Tetap READ-ONLY: server tak pernah memasang apa pun (ADR-0048). `hanoman update` di CLI yang
// melakukannya, karena instance yang me-`npm i` dirinya sendiri lalu keluar akan memutus sesi tmux
// yang sedang berjalan tanpa peringatan.
export const UPDATE_COMMAND = "npm i -g hanoman@latest";

export type UpdateInputs = {
  currentVersion: string;
  latestVersion: string | null;
  registryStatus: UpdateRegistryStatus;
  checkedAt: string | null;
};

// Murni & deterministik: seluruh keputusan "update tersedia?" ada di sini, terpisah dari jaringan.
export function composeUpdate(x: UpdateInputs): UpdateStatus {
  const available = x.registryStatus === "ok" && x.latestVersion != null
    && compareSemver(x.latestVersion, x.currentVersion) > 0;
  return {
    currentVersion: x.currentVersion,
    latestVersion: x.latestVersion,
    registry: { status: x.registryStatus, checkedAt: x.checkedAt },
    updateAvailable: available,
    command: available ? UPDATE_COMMAND : "",
  };
}

const RESULT_TTL_MS = 15_000;
const FETCH_TTL_MS = 5 * 60_000;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

let cached: { at: number; value: UpdateStatus } | null = null;
let lastFetchAt = 0;
let lastLatest: string | null = null;
let lastStatus: UpdateRegistryStatus = "unavailable";

// Versi yang sedang jalan: dist/build-info.json (ditanam scripts/stamp-build.mjs), lalu
// package.json paket. Absen keduanya → "0.0.0" (dev): compareSemver tetap aman.
export function runningVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [resolve(here, "build-info.json"), resolve(here, "../package.json")]) {
    try {
      const v = (JSON.parse(readFileSync(p, "utf8")) as { version?: unknown }).version;
      if (typeof v === "string" && v) return v;
    } catch { /* lanjut ke kandidat berikutnya */ }
  }
  return "0.0.0";
}

// Jaringan HANYA di sini, dan hanya bila opt-in (knob HANOMAN_UPDATE_FETCH; test memaksa "0").
async function maybeFetch(): Promise<void> {
  if (!effectiveBool("HANOMAN_UPDATE_FETCH")) return;
  if (lastFetchAt && Date.now() - lastFetchAt < FETCH_TTL_MS) return;
  lastFetchAt = Date.now();
  const base = (effectiveStr("HANOMAN_NPM_REGISTRY") ?? DEFAULT_REGISTRY).replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/hanoman/latest`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) { lastStatus = "unavailable"; lastLatest = null; return; }
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version === "string" && body.version) { lastLatest = body.version; lastStatus = "ok"; }
    else { lastStatus = "unavailable"; lastLatest = null; }
  } catch { lastStatus = "unavailable"; lastLatest = null; }
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) return cached.value;
  await maybeFetch();
  const value = composeUpdate({
    currentVersion: runningVersion(),
    latestVersion: lastLatest,
    registryStatus: lastStatus,
    checkedAt: lastFetchAt ? new Date(lastFetchAt).toISOString() : null,
  });
  cached = { at: Date.now(), value };
  return value;
}

export function _resetUpdateCache(): void {
  cached = null; lastFetchAt = 0; lastLatest = null; lastStatus = "unavailable";
}
