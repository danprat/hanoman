import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { WEBHOOK_ENTITIES } from "@hanoman/shared";

// SPEC-481 · tap Prisma tak bisa melihat SQL mentah maupun `createMany` (SQLite tak mengembalikan
// baris). Keduanya tak dipakai untuk model terlacak hari ini; test ini yang menjaga itu tetap
// benar, karena pelanggarannya gagal SENYAP — peristiwa hilang tanpa satu pun error.
const SRC = resolve(import.meta.dirname, "../src");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
});

const delegates = WEBHOOK_ENTITIES.map((d) => d.model[0]!.toLowerCase() + d.model.slice(1));

describe("penulis yang tak terlihat tap", () => {
  it("tak ada createMany atas model terlacak", () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const d of delegates)
        if (src.includes(`prisma.${d}.createMany`) || src.includes(`tx.${d}.createMany`))
          bad.push(`${f}: ${d}.createMany`);
    }
    expect(bad).toEqual([]);
  });

  it("tak ada $executeRaw / $queryRaw di server/src", () => {
    const bad = walk(SRC).filter((f) => /\$(execute|query)Raw/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
