// SPEC-214 · tanam SHA build ke server/dist/build-info.json supaya server tahu commit mana yang
// sedang ia jalankan (deteksi "kode baru di disk tapi app lama"). dist gitignored.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let sha = "unknown";
try { sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
catch { /* di luar repo git → biarkan "unknown" */ }
const out = resolve(root, "server/dist/build-info.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ sha, builtAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`stamped build-info.json · ${sha}`);
