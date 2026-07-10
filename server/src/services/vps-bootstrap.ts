import { sshExec, type SshTarget } from "./vps-ssh";
import { ensureHanomanKey } from "./vps-key";

// Public key masuk lewat STDIN, tak pernah dirangkai ke string perintah: isinya
// mengandung spasi dan komentar bebas. Idempotent — grep dulu, baru append.
const INSTALL_CMD =
  "mkdir -p ~/.ssh && chmod 700 ~/.ssh && " +
  "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && " +
  'k=$(cat) && { grep -qxF "$k" ~/.ssh/authorized_keys || printf \'%s\\n\' "$k" >> ~/.ssh/authorized_keys; }';

// Password hidup di dalam fungsi ini saja. Yang keluar cuma keyPath.
//
// Verifikasi lewat KONEKSI BARU yang hanya boleh memakai key adalah inti keamanannya:
// tanpa itu kita menyimpan keyPath yang belum tentu bekerja, lalu `harden.sh` mematikan
// PasswordAuthentication dan hanoman terkunci selamanya.
export async function bootstrapKey(t: SshTarget, password: string):
  Promise<{ ok: true; keyPath: string } | { ok: false; out: string }> {
  const { privPath, pub } = ensureHanomanKey();

  const install = await sshExec(t, INSTALL_CMD, { stdin: `${pub}\n`, password, timeoutMs: 60_000 });
  if (install.code !== 0) return { ok: false, out: install.out };

  const verify = await sshExec({ ...t, keyPath: privPath }, "true", { timeoutMs: 30_000 });
  if (verify.code !== 0) return { ok: false, out: verify.out };

  return { ok: true, keyPath: privPath };
}
