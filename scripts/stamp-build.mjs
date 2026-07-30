// SPEC-214 · tanam SHA build ke server/dist/build-info.json supaya server tahu commit mana yang
// sedang ia jalankan (deteksi "kode baru di disk tapi app lama"). dist gitignored.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let sha = "unknown";
try { sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
catch { /* di luar repo git → biarkan "unknown" */ }
// SPEC-398 · ADR-0087 · versi = semver paket npm (sumber tunggal: root package.json). Identitas
// versi hanoman pindah dari SHA git ke semver, tapi SHA tetap ditanam untuk melacak build dev.
let version = "0.0.0";
try { version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version ?? "0.0.0"; }
catch { /* biarkan "0.0.0" */ }
const out = resolve(root, "server/dist/build-info.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ version, sha, builtAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`stamped build-info.json · v${version} · ${sha}`);
