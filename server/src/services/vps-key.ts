import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { effectiveStr } from "../config";

// Identitas hanoman sendiri, bukan ~/.ssh milik pengguna: akses hanoman bisa dicabut
// per-mesin (hapus satu baris di authorized_keys) tanpa menyentuh key pribadi.
export const keyDir = (): string => effectiveStr("HANOMAN_SSH_KEY_DIR") ?? join(homedir(), ".hanoman");

export type HanomanKey = { privPath: string; pubPath: string; pub: string };

export function ensureHanomanKey(): HanomanKey {
  const dir = keyDir();
  const privPath = join(dir, "id_ed25519");
  const pubPath = `${privPath}.pub`;
  if (!existsSync(privPath)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // -N "" : tanpa passphrase — tak ada manusia yang bisa mengetikkannya saat audit
    // terjadwal jam 3 pagi. Kunci privatnya lahir 0600 dari ssh-keygen sendiri.
    execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", "hanoman", "-f", privPath],
      { stdio: ["ignore", "ignore", "pipe"] });
  }
  return { privPath, pubPath, pub: readFileSync(pubPath, "utf8").trim() };
}
