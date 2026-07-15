import { prisma } from "./db";
import { configEntry } from "@hanoman/shared";

// SPEC-215 · ADR-0049 · resolver terpusat: override DB → env → default registry.
// Cache in-memory agar hot-path sinkron; di-refresh saat setConfig/clearConfig.
let cache = new Map<string, string>();

export async function loadConfig(): Promise<void> {
  const rows = await prisma.runtimeConfig.findMany();
  cache = new Map(rows.map((r) => [r.key, r.value]));
}

export function rawDbValue(key: string): string | undefined { return cache.get(key); }

export function effectiveStr(key: string): string | undefined {
  return cache.get(key) ?? process.env[key] ?? configEntry(key)?.default;
}
export function effectiveInt(key: string): number | undefined {
  const v = effectiveStr(key);
  return v === undefined ? undefined : Number(v);
}
export function effectiveBool(key: string): boolean {
  const v = effectiveStr(key);
  return v === "1" || v === "true";
}
export function sourceOf(key: string): "db" | "env" | "default" {
  if (cache.has(key)) return "db";
  if (process.env[key] !== undefined) return "env";
  return "default";
}

export async function setConfig(key: string, value: string): Promise<void> {
  await prisma.runtimeConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  cache.set(key, value);
}
export async function clearConfig(key: string): Promise<void> {
  await prisma.runtimeConfig.deleteMany({ where: { key } });
  cache.delete(key);
}
