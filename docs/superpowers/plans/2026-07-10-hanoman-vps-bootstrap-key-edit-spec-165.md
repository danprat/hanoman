# SPEC-165 — VPS: bootstrap key lewat password + edit registrasi · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VPS yang masih password-only bisa didaftarkan: hanoman memasang key-nya sendiri lewat password sekali pakai lalu membuang password itu; dan registrasi VPS bisa diedit dari UI.

**Architecture:** `password` adalah field DTO transien — tak pernah jadi kolom Prisma, tak pernah masuk log/response. `sshExec` mendapat mode password (`SSH_ASKPASS` + script sementara, tanpa dependensi baru). `bootstrapKey()` memasang public key dari `~/.hanoman/id_ed25519` lewat stdin, lalu memverifikasi dengan koneksi baru key-only sebelum `keyPath` disimpan. `PATCH /vps/:id` sudah ada sejak SPEC-164; UI-nya yang ditambah.

**Tech Stack:** Fastify 4, Prisma 5, zod 3, vitest, React+TS, OpenSSH ≥ 8.4 (`SSH_ASKPASS_REQUIRE`).

**Spec:** `docs/superpowers/specs/2026-07-10-hanoman-vps-bootstrap-key-edit-spec-165-design.md`

## Sudah diverifikasi nyata sebelum plan ini ditulis

Terhadap container Ubuntu ber-`sshd` sungguhan dengan password auth (bukan fixture):

- `SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force` mengirim password non-interaktif tanpa tty
  dan tanpa `sshpass`. Password salah → `Permission denied` seketika (berkat
  `NumberOfPasswordPrompts=1`), tidak menggantung.
- Perintah `authorized_keys` di Task 3 idempotent: dijalankan dua kali → tetap 1 baris,
  mode `700 ~/.ssh` dan `600 authorized_keys`.
- Setelah `PasswordAuthentication no` diberlakukan (yang dilakukan `harden.sh`), password
  ditolak dan **key hanoman tetap jalan** — tak ada lockout. Inilah alasan bootstrap ada.
- Ulangan pelajaran SPEC-164: `sshd` memakai nilai **pertama**; drop-in bernomor kecil
  menang. Jangan pernah menilai konfigurasi dari isi berkas — baca `sshd -T`.

## Global Constraints

- **Shell sesi menunjuk prod:** jalankan SEMUA perintah pnpm/prisma/vitest dengan
  `env -u NODE_ENV -u DATABASE_URL`. Tanpa itu ~41 test gagal palsu dan perintah prisma
  mengenai DB produksi.
- **Perintah test repo ini** adalah `vitest run --no-file-parallelism`. `npx vitest run`
  polos dari root membuat ~24 test gagal palsu (test server berbagi Postgres + socket tmux).
  Per paket: `cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run`.
- **Prisma CLI butuh DATABASE_URL eksplisit:** `env -u NODE_ENV DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman npx prisma …` (dijalankan dari `server/`). SPEC-165 **tidak** mengubah skema, jadi tak ada migration.
- **Checkout ini dipakai sesi Claude lain.** JANGAN `git add -A`, `git add .`, atau
  `git stash`. Commit hanya dengan path eksplisit; cek `git status --short` dulu.
- **Rahasia:** `password` tak pernah masuk database, log, response, pesan error, atau argv.
  Script askpass sementara mode `0700` dan dihapus di `finally`.
- **Jangan sentuh** `audit.sh`, `harden.sh`, `vps-monitor.ts`, `schema.prisma`.
- **Jangan** curl `POST /api/vps/:id/session` atau `POST /api/terminal/sessions` sebagai
  smoke — keduanya men-spawn `claude` sungguhan.
- Komentar kode bahasa Indonesia, padat, sesuai gaya file tetangga. UI memakai komponen
  `src/src/ds` (`StatusPill`, `Modal`, `Field`, `Input`, `Button`).
- Commit: `feat(server): … (SPEC-165)`, baris kosong, lalu
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Tiap selesai task: centang checkbox task itu di plan ini, lalu smoke API nyata (boot
  server + curl) sesuai step-nya.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `server/src/services/vps-key.ts` (baru) | `ensureHanomanKey()` — keypair hanoman, dibuat sekali |
| `server/src/services/vps-ssh.ts` (ubah) | `sshExec` + mode password lewat askpass |
| `server/src/services/vps-bootstrap.ts` (baru) | `bootstrapKey()` — pasang key, verifikasi key-only |
| `server/src/routes/vps.ts` (ubah) | `POST`/`PATCH` menerima `password?` |
| `shared/src/dto.ts` (ubah) | `password` di `zCreateVps`/`zPatchVps` |
| `src/src/screens/VpsScreen.tsx` (ubah) | field password + modal Edit |
| `src/src/api/client.ts` (ubah) | `updateVps`, `password` di `createVps` |

Bootstrap dipisah dari `vps-ssh.ts`: transport tak perlu tahu soal `authorized_keys`, dan
`vps-audit.ts` sudah menunjukkan pola "service tipis di atas `sshExec`".

---

### Task 1: DTO — `password` transien

**Files:**
- Modify: `shared/src/dto.ts` (blok SPEC-164, sesudah `zDocIndex`)
- Test: `shared/test/vps-dto.test.ts` (tambah `describe`)

**Interfaces:**
- Produces: `zCreateVps` & `zPatchVps` dengan `password?: string`. `VpsView` **tidak**
  berubah — password tak pernah keluar dari server.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `shared/test/vps-dto.test.ts` (sebelum baris terakhir file):

```ts
describe("password bootstrap (SPEC-165)", () => {
  it("create menerima password opsional", () => {
    const v = zCreateVps.parse({ name: "w", host: "203.0.113.10", user: "root", password: "s3cret" });
    expect(v.password).toBe("s3cret");
    expect(zCreateVps.parse({ name: "w", host: "203.0.113.10", user: "root" }).password).toBeUndefined();
  });
  it("password kosong ditolak — bukan diam-diam dianggap 'tanpa password'", () => {
    expect(zCreateVps.safeParse({ name: "w", host: "203.0.113.10", user: "root", password: "" }).success).toBe(false);
  });
  it("patch menerima password tanpa memaksa field lain", () => {
    const p = zPatchVps.parse({ password: "s3cret" });
    expect(p.password).toBe("s3cret");
    expect(p.name).toBeUndefined();
  });
});
```

- [x] **Step 2: Jalankan — harus FAIL**

```bash
cd shared && env -u NODE_ENV -u DATABASE_URL npx vitest run vps-dto
```

Expected: FAIL — `v.password` `undefined` (field belum ada, zod membuangnya).

- [x] **Step 3: Implementasi**

Di `shared/src/dto.ts`, ubah `zCreateVps` dan `zPatchVps` menjadi:

```ts
export const zCreateVps = z.object({
  name: z.string().min(1), host: z.string().min(1).regex(HOST_RE),
  user: z.string().min(1).regex(USER_RE),
  port: z.number().int().min(1).max(65535).default(22),
  keyPath: z.string().min(1).optional(),
  // SPEC-165 · transien: dipakai sekali untuk memasang key hanoman, lalu dibuang.
  // TIDAK PERNAH disimpan, di-log, atau dikembalikan. Bila diisi, `keyPath` diabaikan.
  password: z.string().min(1).optional(),
});
// Tanpa default: PATCH {name} tak boleh diam-diam mengembalikan port ke 22.
export const zPatchVps = z.object({
  name: z.string().min(1), host: z.string().min(1).regex(HOST_RE),
  user: z.string().min(1).regex(USER_RE),
  port: z.number().int().min(1).max(65535),
  keyPath: z.string().min(1).nullable(), // null = kembali ke key default server
  password: z.string().min(1),           // SPEC-165 · diisi = bootstrap ulang
}).partial();
```

- [x] **Step 4: Test hijau**

```bash
cd shared && env -u NODE_ENV -u DATABASE_URL npx vitest run vps-dto
```

Expected: PASS (6 test).

- [x] **Step 5: Commit**

```bash
git status --short
git add shared/src/dto.ts shared/test/vps-dto.test.ts
git commit --only shared/src/dto.ts --only shared/test/vps-dto.test.ts -m "feat(shared): password transien di DTO VPS (SPEC-165)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `ensureHanomanKey()` — keypair milik hanoman

**Files:**
- Create: `server/src/services/vps-key.ts`
- Test: `server/test/vps-key.test.ts`

**Interfaces:**
- Produces: `ensureHanomanKey(): { privPath: string; pubPath: string; pub: string }`,
  `keyDir(): string`. Direktori dari `HANOMAN_SSH_KEY_DIR` bila ada, jika tidak
  `~/.hanoman`.

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/vps-key.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHanomanKey } from "../src/services/vps-key";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-key-")); process.env.HANOMAN_SSH_KEY_DIR = dir; });
afterEach(() => { delete process.env.HANOMAN_SSH_KEY_DIR; rmSync(dir, { recursive: true, force: true }); });

describe("ensureHanomanKey (SPEC-165)", () => {
  it("membuat keypair ed25519 dengan mode 600, pub bertanda hanoman", () => {
    const k = ensureHanomanKey();
    expect(k.privPath).toBe(join(dir, "id_ed25519"));
    expect(k.pub).toMatch(/^ssh-ed25519 AAAA/);
    expect(k.pub).toContain("hanoman");
    expect(statSync(k.privPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(k.pubPath, "utf8").trim()).toBe(k.pub);
  });
  it("idempotent: panggilan kedua memakai key yang sama, tidak membuat ulang", () => {
    const a = ensureHanomanKey();
    const priv = readFileSync(a.privPath, "utf8");
    const b = ensureHanomanKey();
    expect(b.pub).toBe(a.pub);
    expect(readFileSync(b.privPath, "utf8")).toBe(priv);
  });
});
```

- [x] **Step 2: Jalankan — harus FAIL**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run vps-key
```

Expected: FAIL — modul `../src/services/vps-key` belum ada.

- [x] **Step 3: Implementasi**

Create `server/src/services/vps-key.ts`:

```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Identitas hanoman sendiri, bukan ~/.ssh milik pengguna: akses hanoman bisa dicabut
// per-mesin (hapus satu baris di authorized_keys) tanpa menyentuh key pribadi.
export const keyDir = (): string => process.env.HANOMAN_SSH_KEY_DIR ?? join(homedir(), ".hanoman");

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
```

- [x] **Step 4: Test hijau**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run vps-key
```

Expected: PASS (2 test).

- [x] **Step 5: Commit**

```bash
git add server/src/services/vps-key.ts server/test/vps-key.test.ts
git commit --only server/src/services/vps-key.ts --only server/test/vps-key.test.ts -m "feat(server): keypair khusus hanoman untuk bootstrap VPS (SPEC-165)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `sshExec` mode password (askpass)

**Files:**
- Modify: `server/src/services/vps-ssh.ts`
- Modify: `server/test/fixtures/fake-ssh.sh` (rekam argv+env)
- Test: `server/test/vps-ssh.test.ts` (tambah `describe`)

**Interfaces:**
- Consumes: —
- Produces: `sshExec(t, cmd, opts)` dengan `opts.password?: string`. Tanpa `password`
  perilakunya persis seperti sekarang (`BatchMode=yes`).

- [x] **Step 1: Fixture merekam argv + env**

Di `server/test/fixtures/fake-ssh.sh`, sisipkan tepat SESUDAH blok
`case "${FAKE_SSH_MODE:-}" in … esac` (baris 4-6) dan SEBELUM `input="$(cat)"`:

```bash
# SPEC-165 · rekam bagaimana ssh dipanggil supaya test bisa memeriksa argumen & env.
if [ -n "${FAKE_SSH_LOG:-}" ]; then
  { echo "ARGV $*"
    echo "ASKPASS ${SSH_ASKPASS:-none}"
    echo "ASKPASS_REQUIRE ${SSH_ASKPASS_REQUIRE:-none}"
    # Nilai passwordnya sendiri TIDAK dicatat — hanya ada/tidaknya.
    echo "HAS_PASSWORD $([ -n "${HANOMAN_SSH_PASSWORD:-}" ] && echo yes || echo no)"
  } >> "$FAKE_SSH_LOG"
fi
```

- [x] **Step 2: Tulis test yang gagal**

Tambahkan di akhir `server/test/vps-ssh.test.ts`:

```ts
import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("sshExec mode password (SPEC-165)", () => {
  let log: string;
  beforeEach(() => { log = join(mkdtempSync(join(tmpdir(), "hanoman-ssh-")), "log"); process.env.FAKE_SSH_LOG = log; });
  afterEach(() => { delete process.env.FAKE_SSH_LOG; rmSync(log, { force: true }); });

  it("password: askpass dipasang, BatchMode TIDAK dipakai", async () => {
    const r = await sshExec(T, "true", { password: "s3cret" });
    expect(r.code).toBe(0);
    const rec = readFileSync(log, "utf8");
    expect(rec).toContain("ASKPASS_REQUIRE force");
    expect(rec).toContain("HAS_PASSWORD yes");
    expect(rec).toContain("PreferredAuthentications=password,keyboard-interactive");
    expect(rec).toContain("PubkeyAuthentication=no");
    expect(rec).toContain("NumberOfPasswordPrompts=1");
    expect(rec).not.toContain("BatchMode=yes");   // BatchMode melarang askpass
  });

  it("tanpa password: BatchMode=yes, tak ada askpass — jalur SPEC-164 tak berubah", async () => {
    await sshExec(T, "true");
    const rec = readFileSync(log, "utf8");
    expect(rec).toContain("BatchMode=yes");
    expect(rec).toContain("ASKPASS none");
    expect(rec).toContain("HAS_PASSWORD no");
  });

  it("script askpass dihapus setelah proses selesai", async () => {
    await sshExec(T, "true", { password: "s3cret" });
    const askpassPath = readFileSync(log, "utf8").match(/^ASKPASS (.+)$/m)![1]!;
    expect(existsSync(askpassPath)).toBe(false);
  });

  it("password tak pernah muncul di argv", async () => {
    await sshExec(T, "true", { password: "s3cret" });
    expect(readFileSync(log, "utf8")).not.toContain("s3cret");
  });
});
```

- [x] **Step 3: Jalankan — harus FAIL**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run vps-ssh
```

Expected: FAIL — `opts.password` belum ada, `ASKPASS_REQUIRE none`.

- [x] **Step 4: Implementasi**

Ganti seluruh isi `server/src/services/vps-ssh.ts`:

```ts
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Test menunjuk HANOMAN_SSH_BIN ke fixture — pola HANOMAN_CLAUDE_BIN di pty.ts.
const sshBin = () => process.env.HANOMAN_SSH_BIN ?? "ssh";

export type SshTarget = { host: string; port: number; user: string; keyPath?: string | null };
export type SshResult = { code: number; out: string };

// Tanpa password (jalur normal SPEC-164): BatchMode — tak pernah ada prompt, koneksi selalu
// key-based, dan itulah yang membuat mematikan PasswordAuthentication aman bagi hanoman.
//
// Dengan password (bootstrap SPEC-165): BatchMode justru HARUS absen — ia melarang segala
// prompt termasuk askpass. Password diserahkan lewat SSH_ASKPASS (OpenSSH ≥ 8.4), bukan
// argv: argv terlihat oleh semua pengguna mesin, environment hanya oleh pemilik proses.
// NumberOfPasswordPrompts=1 membuat password salah gagal seketika, bukan menggantung.
//
// accept-new: koneksi pertama merekam host key; key yang BERUBAH tetap ditolak (MITM).
function askpassScript(): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-askpass-"));
  const path = join(dir, "askpass.sh");
  writeFileSync(path, '#!/bin/sh\nprintf \'%s\' "$HANOMAN_SSH_PASSWORD"\n', { mode: 0o700 });
  return path;
}

export function sshExec(t: SshTarget, remoteCmd: string,
  opts: { stdin?: string; timeoutMs?: number; password?: string } = {}): Promise<SshResult> {
  const auth = opts.password
    ? ["-o", "PreferredAuthentications=password,keyboard-interactive",
       "-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=1"]
    : ["-o", "BatchMode=yes"];
  const askpass = opts.password ? askpassScript() : null;
  const args = [
    "-p", String(t.port), ...auth, "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    ...(!opts.password && t.keyPath ? ["-i", t.keyPath] : []),
    `${t.user}@${t.host}`, remoteCmd,
  ];
  const env = askpass
    ? { ...process.env, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: "force",
        HANOMAN_SSH_PASSWORD: opts.password }
    : process.env;

  return new Promise((resolve) => {
    const p = spawn(sshBin(), args, { stdio: ["pipe", "pipe", "pipe"], env });
    let out = "";
    // ponytail: SIGKILL langsung — ssh yang menggantung melewati ConnectTimeout tak layak SIGTERM dulu.
    const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 60_000);
    const done = (r: SshResult) => {
      clearTimeout(timer);
      // Rahasia hidup sesingkat mungkin: buang skripnya apa pun yang terjadi.
      if (askpass) rmSync(dirname(askpass), { recursive: true, force: true });
      resolve(r);
    };
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.stdin.on("error", () => {});   // proses mati sebelum stdin tertulis (unreachable) — bukan crash
    p.on("close", (code) => done({ code: code ?? 1, out }));
    p.on("error", (e) => done({ code: 127, out: String(e) }));
    if (opts.stdin) p.stdin.write(opts.stdin);
    p.stdin.end();
  });
}
```

- [x] **Step 5: Test hijau**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run vps-ssh
```

Expected: PASS (7 test — 3 lama + 4 baru).

- [x] **Step 6: Smoke nyata terhadap sshd sungguhan**

Bangun container `sshd` ber-password, lalu buktikan `sshExec` mode password menembusnya
(bukan fixture). Simpan skrip di scratchpad, jangan di repo.

```bash
docker rm -f hanoman-sshd-165 2>/dev/null
docker run -d --name hanoman-sshd-165 -p 22222:22 ubuntu:24.04 sleep infinity
docker exec hanoman-sshd-165 bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get -qq update >/dev/null && apt-get -qq install -y openssh-server >/dev/null'
docker exec hanoman-sshd-165 bash -c 'mkdir -p /run/sshd /etc/ssh/sshd_config.d; ssh-keygen -A >/dev/null 2>&1; echo "root:rahasia123" | chpasswd; printf "PermitRootLogin yes\nPasswordAuthentication yes\n" > /etc/ssh/sshd_config.d/00-test.conf; sshd -t && echo "config valid"'
docker exec -d hanoman-sshd-165 /usr/sbin/sshd -D
sleep 3
cd server && env -u NODE_ENV -u DATABASE_URL npx tsx -e '
  import { sshExec } from "./src/services/vps-ssh";
  const t = { host: "localhost", port: 22222, user: "root" };
  sshExec(t, "id -un", { password: "rahasia123" }).then((r) => console.log("BENAR:", r.code, r.out.trim()));
  sshExec(t, "id -un", { password: "salah" }).then((r) => console.log("SALAH:", r.code, r.out.trim().split("\n").pop()));
'
```

Expected: `BENAR: 0 root` dan `SALAH: 255 … Permission denied …` (gagal cepat, tak menggantung).
Container dibiarkan hidup — Task 4 memakainya lagi. `docker rm -f hanoman-sshd-165` setelah Task 4.

- [x] **Step 7: Commit**

```bash
git add server/src/services/vps-ssh.ts server/test/vps-ssh.test.ts server/test/fixtures/fake-ssh.sh
git commit --only server/src/services/vps-ssh.ts --only server/test/vps-ssh.test.ts --only server/test/fixtures/fake-ssh.sh -m "feat(server): sshExec mode password lewat SSH_ASKPASS, tanpa dependensi baru (SPEC-165)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `bootstrapKey()` — pasang key, verifikasi key-only

**Files:**
- Create: `server/src/services/vps-bootstrap.ts`
- Modify: `server/test/fixtures/fake-ssh.sh` (mode `bootstrap-verify-fail`, `bad-password`)
- Test: `server/test/vps-bootstrap.test.ts`

**Interfaces:**
- Consumes: `sshExec` + `SshTarget` (Task 3), `ensureHanomanKey` (Task 2).
- Produces: `bootstrapKey(t: SshTarget, password: string): Promise<{ ok: true; keyPath: string } | { ok: false; out: string }>`

- [x] **Step 1: Fixture — dua mode baru**

Di `server/test/fixtures/fake-ssh.sh`, ganti blok `case "${FAKE_SSH_MODE:-}" in … esac`
(yang menangani `unreachable`) menjadi:

```bash
case "${FAKE_SSH_MODE:-}" in
  unreachable) echo "ssh: connect to host x port 22: Connection refused" >&2; exit 255 ;;
  # SPEC-165 · login password ditolak (password salah / PasswordAuthentication off)
  bad-password)
    if [ -n "${HANOMAN_SSH_PASSWORD:-}" ]; then
      echo "root@x: Permission denied (publickey,password)." >&2; exit 255
    fi ;;
esac
```

Lalu, tepat SESUDAH baris `last="${*: -1}"`, sisipkan:

```bash
# SPEC-165 · verifikasi key-only pasca-bootstrap gagal (key tak benar-benar terpasang).
if [ "${FAKE_SSH_MODE:-}" = "bootstrap-verify-fail" ] && [ -z "${HANOMAN_SSH_PASSWORD:-}" ]; then
  echo "root@x: Permission denied (publickey)." >&2; exit 255
fi
```

- [x] **Step 2: Tulis test yang gagal**

Create `server/test/vps-bootstrap.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapKey } from "../src/services/vps-bootstrap";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const T = { host: "198.51.100.50", port: 22, user: "root" };
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hanoman-bs-"));
  process.env.HANOMAN_SSH_KEY_DIR = dir;
  process.env.HANOMAN_SSH_BIN = FAKE_SSH;
  delete process.env.FAKE_SSH_MODE;
});
afterEach(() => {
  delete process.env.HANOMAN_SSH_KEY_DIR; delete process.env.FAKE_SSH_MODE;
  rmSync(dir, { recursive: true, force: true });
});

describe("bootstrapKey (SPEC-165)", () => {
  it("sukses → keyPath menunjuk key privat hanoman", async () => {
    const r = await bootstrapKey(T, "s3cret");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.keyPath).toBe(join(dir, "id_ed25519"));
  });
  it("password ditolak → ok:false, alasannya diteruskan", async () => {
    process.env.FAKE_SSH_MODE = "bad-password";
    const r = await bootstrapKey(T, "salah");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.out).toContain("Permission denied");
  });
  it("login password sukses tapi verifikasi key gagal → ok:false (keyPath tak boleh dipakai)", async () => {
    process.env.FAKE_SSH_MODE = "bootstrap-verify-fail";
    const r = await bootstrapKey(T, "s3cret");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.out).toContain("Permission denied");
  });
});
```

- [x] **Step 3: Jalankan — harus FAIL**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run vps-bootstrap
```

Expected: FAIL — modul `../src/services/vps-bootstrap` belum ada.

- [x] **Step 4: Implementasi**

Create `server/src/services/vps-bootstrap.ts`:

```ts
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
```

- [x] **Step 5: Test hijau**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run vps-bootstrap vps-ssh
```

Expected: PASS (3 + 7).

- [x] **Step 6: Smoke nyata — bootstrap terhadap sshd sungguhan**

Pakai container dari Task 3 Step 6 (`hanoman-sshd-165`, port 22222, `root`/`rahasia123`).

```bash
cd server && env -u NODE_ENV -u DATABASE_URL HANOMAN_SSH_KEY_DIR=/tmp/hanoman-key-smoke npx tsx -e '
  import { bootstrapKey } from "./src/services/vps-bootstrap";
  import { sshExec } from "./src/services/vps-ssh";
  const t = { host: "localhost", port: 22222, user: "root" };
  (async () => {
    const a = await bootstrapKey(t, "rahasia123");
    console.log("bootstrap #1:", JSON.stringify(a));
    const b = await bootstrapKey(t, "rahasia123");   // idempotent
    console.log("bootstrap #2:", JSON.stringify(b));
    if (!a.ok) return;
    const r = await sshExec({ ...t, keyPath: a.keyPath }, "wc -l < ~/.ssh/authorized_keys");
    console.log("baris authorized_keys (harus 1):", r.out.trim());
  })();
'
```

Expected: dua-duanya `{"ok":true,...}` dan `baris authorized_keys (harus 1): 1`.

Lalu buktikan **tidak ada lockout** — matikan password auth persis seperti `harden.sh`:

```bash
docker exec hanoman-sshd-165 sh -c 'rm -f /etc/ssh/sshd_config.d/00-test.conf; printf "PermitRootLogin prohibit-password\nPasswordAuthentication no\n" > /etc/ssh/sshd_config.d/01-hanoman.conf; sshd -t && pkill -f "sshd -D"'
docker exec -d hanoman-sshd-165 /usr/sbin/sshd -D && sleep 2
docker exec hanoman-sshd-165 sshd -T | grep -E '^(passwordauthentication|permitrootlogin) '
cd server && env -u NODE_ENV -u DATABASE_URL HANOMAN_SSH_KEY_DIR=/tmp/hanoman-key-smoke npx tsx -e '
  import { sshExec } from "./src/services/vps-ssh";
  const t = { host: "localhost", port: 22222, user: "root", keyPath: "/tmp/hanoman-key-smoke/id_ed25519" };
  sshExec(t, "echo KEY-JALAN").then((r) => console.log("key setelah password mati:", r.code, r.out.trim()));
'
docker rm -f hanoman-sshd-165; rm -rf /tmp/hanoman-key-smoke
```

Expected: `passwordauthentication no`, lalu `key setelah password mati: 0 KEY-JALAN`.

- [x] **Step 7: Commit**

```bash
git add server/src/services/vps-bootstrap.ts server/test/vps-bootstrap.test.ts server/test/fixtures/fake-ssh.sh
git commit --only server/src/services/vps-bootstrap.ts --only server/test/vps-bootstrap.test.ts --only server/test/fixtures/fake-ssh.sh -m "feat(server): bootstrapKey — pasang key hanoman lewat password, verifikasi key-only (SPEC-165)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Route — `POST`/`PATCH` menerima `password`

**Files:**
- Modify: `server/src/routes/vps.ts`
- Test: `server/test/vps.route.test.ts` (tambah `describe`)

**Interfaces:**
- Consumes: `bootstrapKey` (Task 4), DTO (Task 1).
- Produces: `POST /vps` dengan `password` → 201 `keyPath` terisi, tanpa `password` di
  response; gagal → 502 dan **tak ada baris**. `PATCH /vps/:id` dengan `password` →
  bootstrap ulang memakai host/user/port hasil merge.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/vps.route.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("bootstrap lewat password (SPEC-165)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-route-key-")); process.env.HANOMAN_SSH_KEY_DIR = dir; });
  afterEach(() => { delete process.env.HANOMAN_SSH_KEY_DIR; rmSync(dir, { recursive: true, force: true }); });

  it("POST dengan password → 201, keyPath terisi, password tak dikembalikan", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps",
      payload: { name: "bs1", host: "198.51.100.60", user: "root", password: "s3cret" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().keyPath).toBe(join(dir, "id_ed25519"));
    expect(JSON.stringify(res.json())).not.toContain("s3cret");
    expect((await prisma.vps.findUnique({ where: { id: res.json().id } }))!.keyPath).toBe(join(dir, "id_ed25519"));
  });

  it("bootstrap gagal → 502 dan TIDAK ada baris yang lahir", async () => {
    process.env.FAKE_SSH_MODE = "bad-password";
    const before = await prisma.vps.count();
    const res = await app.inject({ method: "POST", url: "/api/vps",
      payload: { name: "bs2", host: "198.51.100.61", user: "root", password: "salah" } });
    expect(res.statusCode).toBe(502);
    expect(res.json().out).toContain("Permission denied");
    expect(await prisma.vps.count()).toBe(before);
  });

  it("POST tanpa password tetap seperti SPEC-164 (tak ada ssh sama sekali)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps",
      payload: { name: "bs3", host: "198.51.100.62", user: "deploy" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().keyPath).toBeNull();
  });

  it("PATCH dengan password → bootstrap ulang, keyPath diperbarui", async () => {
    const v = await makeVps({ name: "bs4", host: "198.51.100.63", user: "root", keyPath: null });
    const res = await app.inject({ method: "PATCH", url: `/api/vps/${v.id}`, payload: { password: "s3cret" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().keyPath).toBe(join(dir, "id_ed25519"));
    expect(JSON.stringify(res.json())).not.toContain("s3cret");
  });

  it("PATCH dengan password yang ditolak → 502, baris tak berubah", async () => {
    process.env.FAKE_SSH_MODE = "bad-password";
    const v = await makeVps({ name: "bs5", host: "198.51.100.64", user: "root", keyPath: null });
    const res = await app.inject({ method: "PATCH", url: `/api/vps/${v.id}`, payload: { password: "salah" } });
    expect(res.statusCode).toBe(502);
    expect((await prisma.vps.findUnique({ where: { id: v.id } }))!.keyPath).toBeNull();
  });

  it("PATCH tanpa password tak menyentuh ssh dan tetap parsial", async () => {
    const v = await makeVps({ name: "bs6", host: "198.51.100.65", user: "deploy", port: 2200 });
    const res = await app.inject({ method: "PATCH", url: `/api/vps/${v.id}`, payload: { name: "bs6b" } });
    expect(res.json().name).toBe("bs6b");
    expect(res.json().port).toBe(2200);
  });
});
```

- [x] **Step 2: Jalankan — harus FAIL**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run vps.route
```

Expected: FAIL — `POST` melempar (Prisma menolak kolom `password`) atau `keyPath` null.

- [x] **Step 3: Implementasi**

Di `server/src/routes/vps.ts`, tambahkan impor:

```ts
import { bootstrapKey } from "../services/vps-bootstrap";
```

Ganti handler `POST /vps` dan `PATCH /vps/:id` menjadi:

```ts
  // `password` transien (SPEC-165): dipakai memasang key hanoman, lalu hilang bersama
  // request ini. Bootstrap dijalankan SEBELUM baris lahir — gagal berarti tak ada sampah.
  app.post("/vps", async (req, reply) => {
    const p = zCreateVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const { password, ...data } = p.data;
    if (password) {
      const bs = await bootstrapKey({ host: data.host, port: data.port, user: data.user }, password);
      if (!bs.ok) return reply.code(502).send({ error: "bootstrap key gagal lewat ssh", out: bs.out });
      data.keyPath = bs.keyPath;
    }
    return reply.code(201).send(await prisma.vps.create({ data }));
  });

  app.patch("/vps/:id", async (req, reply) => {
    const p = zPatchVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const { id } = req.params as { id: string };
    const { password, ...data } = p.data;
    const current = await prisma.vps.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: "not found" });
    if (password) {
      // Bootstrap ulang memakai nilai SESUDAH patch: mengganti host & password sekaligus harus bekerja.
      const bs = await bootstrapKey({
        host: data.host ?? current.host, port: data.port ?? current.port, user: data.user ?? current.user,
      }, password);
      if (!bs.ok) return reply.code(502).send({ error: "bootstrap key gagal lewat ssh", out: bs.out });
      data.keyPath = bs.keyPath;
    }
    return prisma.vps.update({ where: { id }, data });
  });
```

Catatan tipe: `data` hasil destructuring `zCreateVps` bertipe `{ …; keyPath?: string }`, dan dari
`zPatchVps` bertipe `{ …; keyPath?: string | null }` — `data.keyPath = bs.keyPath` sah di keduanya.
Target ssh dibangun eksplisit (bukan `{ ...current, ...data }`) supaya tak menyeret `name`/`audit`
ke dalam `SshTarget`, dan supaya "nilai sesudah patch" terbaca hitam-putih.

- [x] **Step 4: Test hijau**

```bash
cd server && env -u NODE_ENV -u DATABASE_URL npx vitest run
```

Expected: PASS semua (suite server, termasuk 18 test vps.route).

- [x] **Step 5: Smoke API nyata**

```bash
lsof -ti tcp:8799 | xargs -r kill -9
env -u NODE_ENV -u DATABASE_URL PORT=8799 ./server/node_modules/.bin/tsx server/src/server.ts &
sleep 7
# host TEST-NET → bootstrap gagal → 502, dan TIDAK ada baris tersisa
curl -s -X POST localhost:8799/api/vps -H 'content-type: application/json' \
  -d '{"name":"smoke165","host":"192.0.2.1","user":"root","password":"apa saja"}' -w '\n[http %{http_code}]\n' --max-time 90
curl -s localhost:8799/api/vps    # harus [] — tak ada baris setengah jadi
lsof -ti tcp:8799 | xargs -r kill -9
```

Expected: `502` dengan `{"error":"bootstrap key gagal lewat ssh","out":"ssh: connect …"}` dan daftar `[]`.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/vps.ts server/test/vps.route.test.ts
git commit --only server/src/routes/vps.ts --only server/test/vps.route.test.ts -m "feat(server): POST/PATCH /vps menerima password untuk bootstrap key (SPEC-165)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: UI — field password + modal Edit

**Files:**
- Modify: `src/src/api/client.ts`
- Modify: `src/src/screens/VpsScreen.tsx`
- Test: `src/test/vps-screen.test.tsx` (tambah `describe`)

**Interfaces:**
- Consumes: endpoint Task 5.
- Produces: `api.createVps` menerima `password?`; `api.updateVps(id, body)`;
  `VpsScreen` menampilkan modal Edit; helper `vpsFormToBody(f: VpsForm)` diekspor untuk test.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/vps-screen.test.tsx`. Ganti blok `vi.mock` yang ada menjadi:

```tsx
// vi.mock di-hoist ke atas berkas — factory-nya TIDAK boleh merujuk `const` biasa.
// vi.hoisted menaikkan mock fn-nya bersama vi.mock, jadi test bisa memeriksanya.
const { updateVps } = vi.hoisted(() => ({ updateVps: vi.fn() }));
vi.mock("../src/api/client", () => ({
  api: { listVps: vi.fn(async () => [VPS]), updateVps },
  ApiError: class extends Error {},
}));
```

Lalu di dalam `describe("modal edit …")`, beri nilai balik sebelum render:
`updateVps.mockResolvedValue({ ...VPS, name: "web-1b" });`

lalu tambahkan di akhir file:

```tsx
import { vpsFormToBody } from "../src/screens/VpsScreen";
import { fireEvent } from "@testing-library/react";

describe("form → body (SPEC-165)", () => {
  const base = { name: "w", host: "h", user: "root", port: "22", keyPath: "", password: "" };
  it("password kosong tak dikirim; keyPath kosong tak dikirim", () => {
    expect(vpsFormToBody(base)).toEqual({ name: "w", host: "h", user: "root", port: 22 });
  });
  it("password diisi ikut terkirim", () => {
    expect(vpsFormToBody({ ...base, password: "s3cret" }).password).toBe("s3cret");
  });
  it("port bukan angka jatuh ke 22", () => {
    expect(vpsFormToBody({ ...base, port: "abc" }).port).toBe(22);
  });
});

describe("modal edit (SPEC-165)", () => {
  it("tombol Edit membuka modal berisi nilai VPS, submit memanggil updateVps", async () => {
    render(<VpsScreen onToast={() => {}} onGotoTerminal={() => {}} />);
    fireEvent.click(await screen.findByTitle("Edit web-1"));
    expect((await screen.findByDisplayValue("web-1"))).toBeTruthy();
    expect(screen.getByDisplayValue("203.0.113.10")).toBeTruthy();
    fireEvent.click(screen.getByText("Simpan"));
    expect(updateVps).toHaveBeenCalled();
    expect(updateVps.mock.calls[0]![0]).toBe("v1");
  });
});
```

- [x] **Step 2: Jalankan — harus FAIL**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run vps-screen
```

Expected: FAIL — `vpsFormToBody` belum diekspor, tak ada tombol `Edit web-1`.

- [x] **Step 3: api client**

Di `src/src/api/client.ts`, ganti `createVps` dan tambahkan `updateVps` tepat di bawahnya:

```ts
  createVps: (b: { name: string; host: string; user: string; port?: number; keyPath?: string; password?: string }) =>
    j<VpsView>(paths.vps, { method: "POST", ...body(b) }),
  // SPEC-165 · `password` = bootstrap ulang key hanoman; tak pernah disimpan.
  updateVps: (id: string, b: { name?: string; host?: string; user?: string; port?: number;
    keyPath?: string | null; password?: string }) =>
    j<VpsView>(paths.vpsOne(id), { method: "PATCH", ...body(b) }),
```

- [x] **Step 4: VpsScreen — form bersama, modal Edit**

Di `src/src/screens/VpsScreen.tsx`:

**(a)** Ganti `type VpsForm` dan tambahkan helper + field password. Ganti seluruh blok
`type VpsForm … function NewVpsModal(…) { … }` menjadi:

```tsx
export type VpsForm = { name: string; host: string; user: string; port: string; keyPath: string; password: string };

// Field kosong TIDAK dikirim: string kosong akan ditolak zod (min(1)), dan `keyPath: ""`
// bukan cara mengosongkan keyPath — itu `null`, lewat modal Edit.
export function vpsFormToBody(f: VpsForm) {
  const b: Record<string, unknown> = {
    name: f.name.trim(), host: f.host.trim(), user: f.user.trim(), port: Number(f.port) || 22 };
  if (f.keyPath.trim()) b.keyPath = f.keyPath.trim();
  if (f.password) b.password = f.password;
  return b as { name: string; host: string; user: string; port: number; keyPath?: string; password?: string };
}

const PASSWORD_HINT = "opsional — dipakai sekali untuk memasang key hanoman, tidak disimpan";

// Satu form untuk daftar & edit: bedanya cuma judul, tombol, dan nilai awal.
function VpsModal({ open, title, submitLabel, initial, onClose, onSubmit }:
  { open: boolean; title: string; submitLabel: string; initial: VpsForm;
    onClose: () => void; onSubmit: (f: VpsForm) => void }) {
  const [f, setF] = React.useState(initial);
  React.useEffect(() => { if (open) setF(initial); }, [open, initial]);
  const set = (k: keyof VpsForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const canSubmit = !!(f.name.trim() && f.host.trim() && f.user.trim());
  return (
    <Modal open={open} onClose={onClose} icon="server" eyebrow="infra" title={title}
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" onClick={() => canSubmit && onSubmit(f)}>{submitLabel}</Button>
      </>}>
      <Field label="Nama"><Input value={f.name} onChange={set("name")} placeholder="mis. web-1" style={{ width: "100%" }} /></Field>
      <Field label="Host" hint="hostname atau IP — tanpa user@">
        <Input value={f.host} onChange={set("host")} mono placeholder="203.0.113.10" style={{ width: "100%" }} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <Field label="User SSH" hint="root atau user ber-passwordless-sudo">
          <Input value={f.user} onChange={set("user")} mono placeholder="deploy" style={{ width: "100%" }} /></Field>
        <Field label="Port"><Input value={f.port} onChange={set("port")} mono style={{ width: "100%" }} /></Field>
      </div>
      <Field label="Password SSH" hint={PASSWORD_HINT}>
        <Input type="password" value={f.password} onChange={set("password")}
          placeholder="untuk VPS yang belum punya key" style={{ width: "100%" }} /></Field>
      <Field label="Key path" hint="kosongkan bila memakai password di atas, atau key default mesin server">
        <Input value={f.keyPath} onChange={set("keyPath")} mono placeholder="~/.ssh/id_ed25519" style={{ width: "100%" }} /></Field>
    </Modal>
  );
}

const BLANK: VpsForm = { name: "", host: "", user: "", port: "22", keyPath: "", password: "" };
const formOf = (v: VpsView): VpsForm => ({
  name: v.name, host: v.host, user: v.user, port: String(v.port), keyPath: v.keyPath ?? "", password: "" });
```

**(b)** Di dalam `VpsScreen`, ganti state `const [modal, setModal] = React.useState(false);` menjadi:

```tsx
  // null = tertutup · "new" = daftar · VpsView = edit
  const [modal, setModal] = React.useState<null | "new" | VpsView>(null);
```

**(c)** Ganti fungsi `create` dan tambahkan `save`:

```tsx
  async function create(f: VpsForm) {
    try {
      const v = await api.createVps(vpsFormToBody(f));
      setModal(null); load();
      onToast(f.password ? `${v.name} terdaftar · key hanoman terpasang · password dibuang`
                         : `${v.name} terdaftar · jalankan audit`, "ok", "server");
    } catch { onToast("Gagal mendaftarkan VPS — cek host/user, atau password SSH-nya", "err", "x-circle"); }
  }

  async function save(target: VpsView, f: VpsForm) {
    try {
      const v = await api.updateVps(target.id, vpsFormToBody(f));
      setModal(null); load();
      onToast(f.password ? `${v.name} diperbarui · key hanoman terpasang · password dibuang`
                         : `${v.name} diperbarui`, "ok", "server");
    } catch { onToast("Gagal memperbarui VPS", "err", "x-circle"); }
  }
```

**(d)** Ganti setiap `setModal(true)` menjadi `setModal("new")`, lalu ganti KEDUA pemakaian
`<NewVpsModal … />` (di cabang daftar kosong dan di akhir `return`) dengan satu blok:

```tsx
      <VpsModal open={modal === "new"} title="Daftarkan VPS" submitLabel="Daftarkan"
        initial={BLANK} onClose={() => setModal(null)} onSubmit={create} />
      {modal && modal !== "new" && (
        <VpsModal open title={`Edit ${modal.name}`} submitLabel="Simpan" initial={formOf(modal)}
          onClose={() => setModal(null)} onSubmit={(f) => save(modal, f)} />
      )}
```

**(e)** Tambahkan tombol Edit di baris, tepat SEBELUM tombol hapus (`leftIcon="trash-2"`):

```tsx
              <Button size="sm" variant="ghost" leftIcon="pencil" title={`Edit ${v.name}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); setModal(v); }} />
```

- [x] **Step 5: Test hijau + typecheck**

```bash
cd src && env -u NODE_ENV -u DATABASE_URL npx vitest run
cd .. && env -u NODE_ENV -u DATABASE_URL pnpm -r typecheck
```

Expected: semua PASS, 0 error typecheck.

- [x] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/screens/VpsScreen.tsx src/test/vps-screen.test.tsx
git commit --only src/src/api/client.ts --only src/src/screens/VpsScreen.tsx --only src/test/vps-screen.test.tsx -m "feat(web): field password bootstrap + modal edit VPS (SPEC-165)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Verifikasi end-to-end + docs

**Files:**
- Modify: `internal/docs/architecture/api-contract.md` (bagian VPS)
- Modify: `docs/superpowers/plans/2026-07-10-hanoman-vps-bootstrap-key-edit-spec-165.md` (checklist)

- [x] **Step 1: Suite penuh**

```bash
env -u NODE_ENV -u DATABASE_URL npx vitest run --no-file-parallelism
env -u NODE_ENV -u DATABASE_URL pnpm -r typecheck
```

Expected: hijau semua. Bila ada test lama gagal yang TIDAK menyentuh berkas SPEC-165,
laporkan — jangan tambal membabi-buta.

- [x] **Step 2: Smoke UI nyata (CDP)**

Bangun dashboard dan sajikan dari satu proses (jalur produksi), lalu drive lewat
Chrome headless — port 8787 dipakai sesi lain, jadi JANGAN memakai proxy Vite.

```bash
(cd src && env -u NODE_ENV -u DATABASE_URL npx vite build)
lsof -ti tcp:8799 | xargs -r kill -9
env -u NODE_ENV -u DATABASE_URL NODE_ENV=production \
  DATABASE_URL=postgresql://hanoman:hanoman@localhost:5432/hanoman PORT=8799 \
  ./server/node_modules/.bin/tsx server/src/server.ts &
sleep 7
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9333 --user-data-dir=/tmp/hanoman-chrome about:blank &
```

Yang harus terlihat, lewat CDP (pola `smoke.mjs` di SPEC-164):
1. Nav VPS → daftarkan VPS TEST-NET **tanpa** password → baris muncul, `keyPath` null.
2. Klik pensil → modal berisi nama/host/user/port yang benar → ubah nama → Simpan →
   nama di daftar berubah (bukti `PATCH` terpasang di UI).
3. Modal daftar punya field bertipe `password`
   (`document.querySelector('input[type=password]')` tidak null).
4. Bersihkan: `DELETE` semua baris smoke, matikan Chrome dan server.

JANGAN klik Harden atau Sesi Claude. JANGAN mengetik password sungguhan ke VPS nyata.

- [x] **Step 3: Update kontrak API**

Di `internal/docs/architecture/api-contract.md`, pada blok kode bagian `## VPS`, ganti dua
baris `POST /vps` dan `PATCH /vps/:id` menjadi:

```
POST   /vps  {name,host,user,port?,keyPath?,password?}  # 201 · 400 host/user cacat
                                     # password (SPEC-165) = bootstrap key sekali pakai:
                                     # dipasang ke authorized_keys, diverifikasi key-only,
                                     # lalu dibuang. Gagal → 502 dan TIDAK ada baris lahir.
PATCH  /vps/:id                      # parsial · 200 · 400 · 404
                                     # `password` = bootstrap ulang → 502 bila gagal
```

dan tambahkan satu kalimat di paragraf `>` di bawahnya:

```
> Password tak pernah disimpan, di-log, atau dikembalikan; ia diserahkan ke ssh lewat
> SSH_ASKPASS (bukan argv) dan hidup beberapa detik di env proses anak (ADR-0025, SPEC-165).
```

- [x] **Step 4: Centang checklist + commit penutup**

```bash
git add internal/docs/architecture/api-contract.md docs/superpowers/plans/2026-07-10-hanoman-vps-bootstrap-key-edit-spec-165.md
git commit --only internal/docs/architecture/api-contract.md --only docs/superpowers/plans/2026-07-10-hanoman-vps-bootstrap-key-edit-spec-165.md -m "docs(spec-165): kontrak API bootstrap password + centang checklist

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```


---

## Hasil verifikasi (2026-07-10)

Tujuh task selesai. `vitest run --no-file-parallelism`: **316 test, 53 file, hijau**;
`pnpm -r typecheck` bersih di lima paket.

### Diverifikasi nyata, bukan lewat fixture saja

- **`sshExec` mode password terhadap `sshd` sungguhan** (container Ubuntu, password auth):
  password benar → `exit 0`, perintah jalan. Password salah → `Permission denied` seketika,
  tidak menggantung.
- **`bootstrapKey` end-to-end:** memasang key lewat password, dijalankan dua kali → tetap
  1 baris di `authorized_keys` (idempotent). Verifikasi key-only lolos.
- **Bukti tak ada lockout:** `PasswordAuthentication no` diberlakukan persis seperti
  `harden.sh`, `sshd -T` mengonfirmasi `passwordauthentication no` — password lalu **ditolak**
  (`Permission denied (publickey)`) sementara **key hanoman tetap jalan**. Inilah seluruh
  alasan bootstrap ada.
- **Endpoint dengan ssh asli:** `POST /vps` dengan password ke host TEST-NET → **502** rapi,
  daftar tetap `[]` (tak ada baris setengah jadi), dan **password tak muncul di log server**.
- **UI di browser sungguhan (CDP):** modal daftar punya `input[type=password]`; daftar tanpa
  password → `keyPath` null; klik pensil → modal terisi nama & host yang benar → ubah nama →
  Simpan → nama berubah di daftar dan di DB, `port` tak tersentuh (patch parsial).

### Catatan

- Uji anti-lockout sempat **lolos palsu**: `00-test.conf` buatan smoke sorting-nya sebelum
  `01-hanoman.conf`, jadi `PasswordAuthentication yes` masih menang. `sshd -T` yang
  menyingkapnya. Jangan pernah menilai konfigurasi sshd dari isi berkas.
- Tak ada perubahan skema, tak ada migration, tak ada ADR baru. `audit.sh`, `harden.sh`,
  dan `vps-monitor.ts` tak disentuh.
