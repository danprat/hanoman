// SPEC-398 · ADR-0087 · perintah DEV (sengaja tak didokumentasikan di --help): merakit dist-npm/.
// Ia hidup di CLI, bukan di scripts/*.mjs, supaya logikanya TypeScript & bertest.
// Ia TIDAK pernah memanggil `npm publish` — menerbitkan paket adalah tindakan manusia.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Ctx } from "../router";
import { resolveLayout } from "../layout";
import { distDir } from "./start";
import { BIN_SHIM, REQUIRED_ARTIFACTS, RUNTIME_DEPS, copyPlan, packageJsonFor } from "../release/pack";

// Versi dependency diambil dari package.json yang NYATA dipakai workspace, jadi paket terbit tak
// pernah memasang versi berbeda dari yang diuji di sini.
function depVersions(repo: string): Record<string, string> {
  const read = (p: string): Record<string, Record<string, string> | undefined> =>
    JSON.parse(readFileSync(join(repo, p), "utf8")) as Record<string, Record<string, string> | undefined>;
  const server = read("server/package.json"), cli = read("cli/package.json");
  const pools = [server.dependencies, server.devDependencies, cli.dependencies, cli.devDependencies];
  const out: Record<string, string> = {};
  for (const d of RUNTIME_DEPS) {
    const v = pools.map((p) => p?.[d]).find((x) => typeof x === "string");
    if (!v) throw new Error(`pack: versi dependency "${d}" tak ditemukan di server/cli package.json`);
    out[d] = v;
  }
  return out;
}

export default async function pack(argv: string[], ctx: Ctx): Promise<number> {
  let repo: string;
  try { repo = resolveLayout(distDir(), existsSync).root; }
  catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 1; }
  if (!existsSync(join(repo, "server/prisma/schema.prisma"))) {
    ctx.stderr("pack: hanya bisa dijalankan dari checkout repo hanoman\n");
    return 1;
  }
  const outIdx = argv.indexOf("--out");
  const out = outIdx === -1 ? join(repo, "dist-npm") : join(repo, argv[outIdx + 1] ?? "dist-npm");
  const version = (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version?: string }).version;
  if (!version) { ctx.stderr("pack: root package.json tanpa field version\n"); return 1; }

  let deps: Record<string, string>;
  try { deps = depVersions(repo); } catch (e) { ctx.stderr(`${(e as Error).message}\n`); return 1; }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "bin"), { recursive: true });
  for (const item of copyPlan(repo)) {
    if (!existsSync(item.from)) {
      ctx.stderr(`pack: artefak hilang — ${item.from} (sudah \`pnpm build\`?)\n`);
      return 1;
    }
    const dest = join(out, item.to);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(item.from, dest, item.dir ? { recursive: true } : {});
  }
  writeFileSync(join(out, "bin/hanoman.mjs"), BIN_SHIM);
  writeFileSync(join(out, "package.json"), JSON.stringify(packageJsonFor(version, deps), null, 2) + "\n");

  const missing = REQUIRED_ARTIFACTS.filter((a) => !existsSync(join(out, a)));
  if (missing.length) { ctx.stderr(`pack: artefak wajib hilang: ${missing.join(", ")}\n`); return 1; }
  ctx.stdout(`pack · ${out} · hanoman@${version} · ${REQUIRED_ARTIFACTS.length} artefak wajib ada\n`);
  ctx.stdout("terbitkan MANUAL: cd dist-npm && npm publish --otp <kode>\n");
  return 0;
}
