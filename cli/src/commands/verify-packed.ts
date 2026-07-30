// SPEC-403 · perintah DEV (tak didokumentasikan di --help): gerbang `prepublishOnly` paket hasil
// rakitan. Ia berjalan DI DALAM `dist-npm/` saat `npm publish`, dengan cwd yang npm tetapkan ke
// akar paket — jadi ia membaca `package.json` yang benar-benar akan dikirim, bukan yang dirakit
// beberapa langkah sebelumnya. Perbedaan itulah yang menerbitkan `0.1.3` tanpa `prisma`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../router";
import { verifyPackedDeps } from "../release/pack";

export default function verifyPacked(_argv: string[], ctx: Ctx): number {
  const path = join(process.cwd(), "package.json");
  let pkg: unknown;
  try { pkg = JSON.parse(readFileSync(path, "utf8")); }
  catch { ctx.stderr(`verify: tak bisa membaca ${path}\n`); return 1; }

  const keluhan = verifyPackedDeps(pkg);
  if (keluhan.length === 0) return 0;

  for (const k of keluhan) ctx.stderr(`verify: ${k}\n`);
  ctx.stderr(
    "\nPublish DIBATALKAN. `dist-npm/package.json` tercemar sesudah dirakit — jangan sunting\n" +
    "berkas itu, rakit ulang: `pnpm release`. Penyebab yang sudah terukur: menjalankan\n" +
    "`npm install`/`npm i -g` dengan cwd di dalam `dist-npm/` menulis ulang package.json-nya.\n",
  );
  return 1;
}
