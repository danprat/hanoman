# SPEC-164 — Modul VPS (audit · healthcheck · hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hanoman bisa mendaftar VPS, meng-audit & healthcheck-nya via script SSH deterministik, menampilkan daftar hardened/belum, mengeksekusi hardening idempotent lewat satu klik, dan membuka sesi Claude untuk kasus lanjutan.

**Architecture:** Tabel `Vps` di Postgres; transport `spawn("ssh")` dengan script bash dikirim lewat stdin (`sudo -n bash -s`); parser output `CHECK`-lines di server; loop `setInterval` untuk healthcheck 5 menit + audit harian (di `server.ts`, bukan `buildApp` — test tak tersentuh); screen VPS baru di frontend. Sesi Claude lanjutan reuse `services/pty.ts` dengan label owner `vps:<id>`.

**Tech Stack:** Fastify 4, Prisma 5 (Postgres), zod 3, vitest, React+TS (Vite), bash (target: Ubuntu/Debian + RHEL-family).

**Spec:** `docs/superpowers/specs/2026-07-10-hanoman-vps-hardening-spec-164-design.md`

## Global Constraints

- **Shell sesi menunjuk prod:** jalankan SEMUA perintah pnpm/prisma dengan `env -u NODE_ENV -u DATABASE_URL` — env sesi berisi `NODE_ENV=production` + `DATABASE_URL=hanoman_prod` dan membuat ±41 test gagal palsu.
- **DB test terpisah:** vitest menurunkan `hanoman_test` dari DATABASE_URL (`server/vitest.config.ts`). Setelah migration baru: jalankan juga `prisma migrate deploy` ke `_test` (lihat Task 1 Step 3) — kalau tidak, semua server test lempar P2022.
- **Worktree ini dipakai sesi Claude lain secara bersamaan:** JANGAN PERNAH `git add -A`, `git add .`, atau `git stash`. Commit hanya dengan `git add <path eksplisit>` file yang kamu buat/ubah sendiri. Sebelum commit, `git status --short` dan pastikan hanya file-mu yang ter-stage (`git commit --only <paths>` lebih aman).
- **Jangan ubah skema tanpa migration + ADR** — ADR-0024 dibuat di Task 1.
- Private key SSH TIDAK PERNAH disimpan di DB/log — hanya `keyPath`.
- Harden TIDAK PERNAH terjadwal — hanya endpoint yang dipanggil tombol.
- Komentar kode bahasa Indonesia, gaya padat seperti file tetangga. UI ikuti design system (`internal/docs/design-system/**`); komponen dari `src/src/ds`.
- **Kebiasaan repo:** tiap selesai task, centang checkbox task itu di file plan ini, lalu smoke-test API nyata (boot server + curl) sesuai step di task. Kecuali: JANGAN pernah curl `POST /api/vps/:id/session` atau `POST /api/terminal/sessions` sebagai smoke — itu men-spawn claude sungguhan.
- Test server: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test`. Test frontend: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test`. Typecheck: `pnpm -r typecheck`.
- Commit message: gaya repo (`feat(server): … (SPEC-164)`), diakhiri baris kosong lalu `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Deviasi yang disengaja dari spec (sudah final, jangan didebat ulang saat implementasi)

1. **`PermitRootLogin`:** bila user SSH yang dikonfigurasi = `root`, harden menulis `prohibit-password` (root key-only), bukan `no` — `no` akan mengunci akses hanoman sendiri. Audit menerima `no` ATAU `prohibit-password` sebagai pass. Task 4 juga meng-update paragraf terkait di spec (commit yang sama).
2. **Injeksi deps ssh:** bukan modul DI, tapi env `HANOMAN_SSH_BIN` (pola yang sama dengan `HANOMAN_CLAUDE_BIN` di `services/pty.ts`). Test menunjuk ke fixture `fake-ssh.sh`.

---

### Task 1: Skema — model `Vps`, migration, ADR-0024

**Files:**
- Modify: `server/prisma/schema.prisma` (tambah model di bawah `Setting`)
- Create: `internal/docs/adr/0024-modul-vps-script-deterministik.md`
- Modify: `server/test/factory.ts` (resetDb + makeVps)

**Interfaces:**
- Produces: model Prisma `Vps` (dipakai semua task server); `makeVps(over?)` di factory (dipakai Task 5–7).

- [ ] **Step 1: Tambah model ke schema**

Di `server/prisma/schema.prisma`, setelah `model Setting`:

```prisma
// SPEC-164 · VPS yang dikelola hanoman. keyPath menunjuk berkas di mesin server —
// isi private key TIDAK PERNAH ada di database.
model Vps {
  id          String    @id @default(cuid())
  name        String
  host        String
  port        Int       @default(22)
  user        String
  keyPath     String?
  createdAt   DateTime  @default(now())
  lastSeenAt  DateTime? // healthcheck sukses terakhir
  health      Json?     // { uptime, disk, mem, load }
  lastAuditAt DateTime?
  audit       Json?     // VpsCheck[] — [{ check, status, detail }]
  hardened    Boolean   @default(false) // derived: semua check kritis pass
}
```

- [ ] **Step 2: Buat migration (DB dev)**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server exec prisma migrate dev --name add_vps
```

Expected: migration `2026…_add_vps` dibuat, `prisma generate` jalan. (Tanpa `env -u`, ini mengenai DB prod — jangan.)

- [ ] **Step 3: Migrate DB test**

`server/vitest.config.ts` menurunkan URL test dengan menambah akhiran `_test` pada nama DB di `server/.env`. Jalankan:

```bash
TEST_URL=$(grep '^DATABASE_URL' server/.env | cut -d'"' -f2 | sed 's#/\([a-zA-Z0-9_]*\)\(\?.*\)\?$#/\1_test\2#')
env -u NODE_ENV DATABASE_URL="$TEST_URL" pnpm --filter ./server exec prisma migrate deploy
```

Expected: `1 migration applied` (atau lebih). Verifikasi: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test` — suite lama tetap hijau (belum ada test vps).

- [ ] **Step 4: factory — reset + helper**

Di `server/test/factory.ts`, ganti `resetDb` dan tambah `makeVps`:

```ts
// Truncate every table in FK-safe order (mirrors the deleted seed()).
export async function resetDb(): Promise<void> {
  await prisma.$transaction([
    prisma.spec.deleteMany(), prisma.setting.deleteMany(), prisma.project.deleteMany(),
    prisma.vps.deleteMany(),
  ]);
}

export function makeVps(over: Partial<Prisma.VpsCreateInput> = {}) {
  return prisma.vps.create({ data: {
    name: "vps1", host: "203.0.113.10", user: "deploy", ...over } });
}
```

- [ ] **Step 5: Tulis ADR-0024**

Create `internal/docs/adr/0024-modul-vps-script-deterministik.md`:

```markdown
# ADR-0024 — Modul VPS: tabel sendiri, script deterministik, tanpa queue

**Status:** diterima · 2026-07-10 · SPEC-164

## Konteks

hanoman perlu meng-audit, memantau, dan men-harden VPS milik pemilik workspace.
VPS bukan Project (Project berporos repoDir/worktree/git), dan pasca SPEC-162
tidak ada lagi queue/Redis untuk pekerjaan terjadwal.

## Keputusan

1. **Tabel `Vps` sendiri** (bukan Project kind baru) — migration `add_vps`.
2. **Audit, healthcheck, dan hardening adalah script bash deterministik** yang
   dikirim via `ssh … 'sudo -n bash -s' < script`. LLM tidak berada di jalur
   standar; sesi Claude interaktif hanya escape-hatch untuk kasus lanjutan.
3. **Penjadwalan via `setInterval` di proses server** (healthcheck 5 menit,
   audit 24 jam) — konsisten dengan arah SPEC-162, tanpa menghidupkan kembali
   queue. Loop hidup di `server.ts`, bukan `buildApp()`, sehingga test bebas timer.
4. **Kredensial:** key/agent milik mesin server; DB hanya menyimpan `keyPath`.
   `BatchMode=yes` menjamin tak pernah ada prompt password.
5. **Harden tidak pernah terjadwal** dan anti-lockout: allow port SSH sebelum
   enable firewall, `sshd -t` sebelum reload, verifikasi koneksi baru pasca-apply,
   `PermitRootLogin prohibit-password` bila user terkonfigurasi = root.

## Konsekuensi

- Status `hardened` = derivasi audit terakhir (semua check kritis pass) — bisa
  basi maksimal satu hari, atau segar setelah tombol Audit/Harden.
- Distro di luar debian/rhel-family ditolak eksplisit (`os_supported` fail).
- Endpoint vps mewarisi postur tanpa-auth + bind 127.0.0.1 (lihat ADR-0016 /
  komentar `routes/terminal.ts`).
```

- [ ] **Step 6: Commit**

```bash
git status --short   # pastikan hanya file di bawah yang akan di-stage
git add server/prisma/schema.prisma server/prisma/migrations server/test/factory.ts internal/docs/adr/0024-modul-vps-script-deterministik.md
git commit --only server/prisma/schema.prisma --only server/prisma/migrations --only server/test/factory.ts --only internal/docs/adr/0024-modul-vps-script-deterministik.md -m "feat(server): model Vps + migration + ADR-0024 (SPEC-164)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared — DTO zod + paths

**Files:**
- Modify: `shared/src/dto.ts`
- Modify: `shared/src/api.ts`
- Test: `shared/test/vps-dto.test.ts` (create)

**Interfaces:**
- Produces: `zCreateVps`, `zPatchVps`, `zVpsCheck`, `type VpsCheck = { check: string; status: "pass"|"fail"|"warn"; detail: string }`, `type VpsHealth = { uptime: string; disk: string; mem: string; load: string }`, `type VpsView`; `paths.vps`, `paths.vpsOne(id)`, `paths.vpsAudit(id)`, `paths.vpsHarden(id)`, `paths.vpsSession(id)`.

- [ ] **Step 1: Test gagal dulu**

Create `shared/test/vps-dto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zCreateVps, zPatchVps } from "../src/dto";

describe("vps dto (SPEC-164)", () => {
  it("create: port default 22, keyPath opsional", () => {
    const v = zCreateVps.parse({ name: "web-1", host: "203.0.113.10", user: "deploy" });
    expect(v.port).toBe(22);
    expect(v.keyPath).toBeUndefined();
  });
  it("host/user dengan metakarakter shell ditolak — argv ssh adalah trust boundary", () => {
    expect(zCreateVps.safeParse({ name: "x", host: "h; rm -rf /", user: "deploy" }).success).toBe(false);
    expect(zCreateVps.safeParse({ name: "x", host: "203.0.113.10", user: "de ploy" }).success).toBe(false);
  });
  it("patch parsial tidak menyuntik port default", () => {
    const p = zPatchVps.parse({ name: "baru" });
    expect("port" in p && p.port !== undefined).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan — harus FAIL**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./shared test
```

Expected: FAIL (`zCreateVps` belum ada).

- [ ] **Step 3: Implementasi**

Di `shared/src/dto.ts`, tambahkan di bagian bawah:

```ts
// SPEC-164 · modul VPS. host/user masuk ke argv ssh dan (user) ke string perintah
// `sudo -n env SSH_USER=…` — regex ini trust boundary, bukan kosmetik.
const HOST_RE = /^[A-Za-z0-9._-]+$/;
const USER_RE = /^[a-z_][a-z0-9_-]*$/i;
export const zCreateVps = z.object({
  name: z.string().min(1), host: z.string().min(1).regex(HOST_RE),
  user: z.string().min(1).regex(USER_RE),
  port: z.number().int().min(1).max(65535).default(22),
  keyPath: z.string().min(1).optional(),
});
// Tanpa default: PATCH {name} tak boleh diam-diam mengembalikan port ke 22.
export const zPatchVps = z.object({
  name: z.string().min(1), host: z.string().min(1).regex(HOST_RE),
  user: z.string().min(1).regex(USER_RE),
  port: z.number().int().min(1).max(65535),
  keyPath: z.string().min(1).nullable(), // null = kembali ke key default server
}).partial();
export const zVpsCheck = z.object({
  check: z.string(), status: z.enum(["pass", "fail", "warn"]), detail: z.string() });
export type VpsCheck = z.infer<typeof zVpsCheck>;
export type VpsHealth = { uptime: string; disk: string; mem: string; load: string };
export type VpsView = {
  id: string; name: string; host: string; port: number; user: string; keyPath: string | null;
  createdAt: string; lastSeenAt: string | null; health: VpsHealth | null;
  lastAuditAt: string | null; audit: VpsCheck[] | null; hardened: boolean;
};
```

Di `shared/src/api.ts`, tambahkan ke `paths` sebelum `} as const;`:

```ts
  vps: `${API}/vps`,
  vpsOne: (id: string) => `${API}/vps/${id}`,
  vpsAudit: (id: string) => `${API}/vps/${id}/audit`,
  vpsHarden: (id: string) => `${API}/vps/${id}/harden`,
  vpsSession: (id: string) => `${API}/vps/${id}/session`,
```

- [ ] **Step 4: Test hijau + commit**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./shared test
git add shared/src/dto.ts shared/src/api.ts shared/test/vps-dto.test.ts
git commit --only shared/src/dto.ts --only shared/src/api.ts --only shared/test/vps-dto.test.ts -m "feat(shared): DTO + paths modul VPS (SPEC-164)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Transport SSH + parser audit/health (TDD)

**Files:**
- Create: `server/src/services/vps-ssh.ts`
- Create: `server/src/services/vps-audit.ts` (parser murni dulu; `runAudit`/`runHealth` menyusul Task 5)
- Modify: `server/src/runner/deps.ts` (ekspor `repoRoot`)
- Create: `server/test/fixtures/fake-ssh.sh` (chmod +x)
- Test: `server/test/vps-audit.test.ts`, `server/test/vps-ssh.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `sshExec(t: SshTarget, remoteCmd: string, opts?: { stdin?: string; timeoutMs?: number }): Promise<{ code: number; out: string }>` dengan `type SshTarget = { host: string; port: number; user: string; keyPath?: string | null }`
  - `parseAudit(out: string): VpsCheck[]`, `isHardened(checks: VpsCheck[]): boolean`, `parseHealth(out: string): VpsHealth | null`, `HEALTH_CMD: string`, `CRITICAL: readonly string[]`
  - `repoRoot(startDir?: string): string` dari `runner/deps.ts`

- [ ] **Step 1: Test parser — gagal dulu**

Create `server/test/vps-audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAudit, isHardened, parseHealth, CRITICAL } from "../src/services/vps-audit";

const PASS_ALL = [
  "CHECK sudo_ok pass root", "CHECK os_supported pass ubuntu 24.04",
  "CHECK ssh_root_login pass", "CHECK ssh_password_auth pass",
  "CHECK firewall pass ufw active", "CHECK fail2ban pass aktif",
  "CHECK auto_updates pass unattended-upgrades",
].join("\n");

describe("parser audit (SPEC-164)", () => {
  it("parse baris CHECK, abaikan noise", () => {
    const out = "Warning: banner\n" + PASS_ALL + "\nCHECK ntp warn NTP tidak aktif\nbukan check\n";
    const checks = parseAudit(out);
    expect(checks.length).toBe(8);
    expect(checks[0]).toEqual({ check: "sudo_ok", status: "pass", detail: "root" });
    expect(checks.at(-1)).toEqual({ check: "ntp", status: "warn", detail: "NTP tidak aktif" });
  });
  it("hardened hanya bila SEMUA check kritis pass", () => {
    expect(isHardened(parseAudit(PASS_ALL))).toBe(true);
    expect(isHardened(parseAudit(PASS_ALL.replace("CHECK firewall pass ufw active", "CHECK firewall fail ufw tidak aktif")))).toBe(false);
    // warn pada check non-kritis tidak menghalangi
    expect(isHardened(parseAudit(PASS_ALL + "\nCHECK open_ports warn 0.0.0.0:5432"))).toBe(true);
    // check kritis yang HILANG = belum hardened
    expect(isHardened(parseAudit(PASS_ALL.split("\n").slice(0, 5).join("\n")))).toBe(false);
  });
  it("CRITICAL memuat 7 check sesuai spec", () => {
    expect([...CRITICAL]).toEqual(["sudo_ok", "os_supported", "ssh_root_login",
      "ssh_password_auth", "firewall", "fail2ban", "auto_updates"]);
  });
  it("parseHealth", () => {
    const h = parseHealth("HEALTH uptime up 3 days\nHEALTH disk 42%\nHEALTH mem 512/2048MB\nHEALTH load 0.1 0.2 0.3\n");
    expect(h).toEqual({ uptime: "up 3 days", disk: "42%", mem: "512/2048MB", load: "0.1 0.2 0.3" });
    expect(parseHealth("motd sampah\n")).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan — FAIL** (`vps-audit` belum ada)

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps-audit
```

- [ ] **Step 3: Implementasi parser**

Create `server/src/services/vps-audit.ts`:

```ts
import type { VpsCheck, VpsHealth } from "@hanoman/shared";

// Check kritis (SPEC-164 §3): semuanya pass → hardened. warn tak menghalangi.
export const CRITICAL = [
  "sudo_ok", "os_supported", "ssh_root_login", "ssh_password_auth",
  "firewall", "fail2ban", "auto_updates",
] as const;

// Baris di luar format (motd, banner, warning ssh) diabaikan diam-diam.
export function parseAudit(out: string): VpsCheck[] {
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^CHECK (\S+) (pass|fail|warn)(?: (.*))?$/);
    return m ? [{ check: m[1], status: m[2] as VpsCheck["status"], detail: (m[3] ?? "").trim() }] : [];
  });
}

export const isHardened = (checks: VpsCheck[]): boolean =>
  CRITICAL.every((c) => checks.find((x) => x.check === c)?.status === "pass");

// Healthcheck: satu perintah remote tanpa sudo, output berlabel — parser yang sama polanya.
export const HEALTH_CMD =
  'echo HEALTH uptime $(uptime -p 2>/dev/null || uptime); ' +
  "echo HEALTH disk $(df -P / | awk 'NR==2{print $5}'); " +
  "echo HEALTH mem $(free -m 2>/dev/null | awk 'NR==2{printf \"%d/%dMB\", $3, $2}'); " +
  'echo HEALTH load $(cut -d" " -f1-3 /proc/loadavg)';

export function parseHealth(out: string): VpsHealth | null {
  const h: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^HEALTH (\S+) ?(.*)$/);
    if (m) h[m[1]] = m[2].trim();
  }
  if (!h.uptime && !h.disk) return null;
  return { uptime: h.uptime ?? "", disk: h.disk ?? "", mem: h.mem ?? "", load: h.load ?? "" };
}
```

- [ ] **Step 4: Test parser hijau**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps-audit
```

- [ ] **Step 5: Fixture ssh palsu**

Create `server/test/fixtures/fake-ssh.sh` lalu `chmod +x server/test/fixtures/fake-ssh.sh`:

```bash
#!/usr/bin/env bash
# ssh palsu (HANOMAN_SSH_BIN) — pola yang sama dengan fake-claude.sh.
# FAKE_SSH_MODE: unreachable | verify-fail | audit-fail | (kosong = sukses)
case "${FAKE_SSH_MODE:-}" in
  unreachable) echo "ssh: connect to host x port 22: Connection refused" >&2; exit 255 ;;
esac
input="$(cat)"          # stdin = isi script (kosong untuk healthcheck/verify)
last="${*: -1}"         # arg terakhir = perintah remote

# verify-fail: harden sukses, tapi koneksi verifikasi berikutnya gagal
if [ "${FAKE_SSH_MODE:-}" = "verify-fail" ] && [[ "$input" != *"hanoman-harden"* ]]; then
  echo "ssh: connect to host x port 22: Connection refused" >&2; exit 255
fi

if [[ "$last" == *"HEALTH"* ]]; then
  echo "HEALTH uptime up 3 days"; echo "HEALTH disk 42%"
  echo "HEALTH mem 512/2048MB"; echo "HEALTH load 0.1 0.2 0.3"; exit 0
fi
if [[ "$input" == *"hanoman-harden"* ]]; then
  echo "STEP precheck ok deb ssh_port=22"; echo "STEP firewall ok ufw aktif"
  echo "STEP fail2ban ok"; echo "STEP auto_updates ok"; echo "STEP ssh ok"; echo "STEP ntp ok"; exit 0
fi
if [[ "$input" == *"hanoman-audit"* ]]; then
  echo "CHECK sudo_ok pass root"; echo "CHECK os_supported pass ubuntu 24.04"
  echo "CHECK ssh_root_login pass"
  if [ "${FAKE_SSH_MODE:-}" = "audit-fail" ]; then
    echo "CHECK ssh_password_auth fail PasswordAuthentication yes"
  else
    echo "CHECK ssh_password_auth pass"
  fi
  echo "CHECK firewall pass ufw active"; echo "CHECK fail2ban pass aktif"
  echo "CHECK auto_updates pass unattended-upgrades"
  echo "CHECK ntp pass aktif"; echo "CHECK open_ports warn port publik tak terdaftar: 5432"
  echo "CHECK pending_updates pass"; exit 0
fi
exit 0   # perintah lain (mis. verify `true`)
```

- [ ] **Step 6: Test transport — gagal dulu**

Create `server/test/vps-ssh.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { sshExec } from "../src/services/vps-ssh";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const T = { host: "203.0.113.10", port: 22, user: "deploy" };
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("sshExec (SPEC-164)", () => {
  it("meneruskan stdin dan mengembalikan stdout", async () => {
    const r = await sshExec(T, "sudo -n bash -s", { stdin: "# hanoman-audit\n" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("CHECK sudo_ok pass");
  });
  it("koneksi gagal → code != 0, stderr ikut di out", async () => {
    process.env.FAKE_SSH_MODE = "unreachable";
    const r = await sshExec(T, "sudo -n bash -s", { stdin: "# hanoman-audit\n" });
    expect(r.code).toBe(255);
    expect(r.out).toContain("Connection refused");
  });
  it("binari ssh hilang → code 127, bukan exception", async () => {
    process.env.HANOMAN_SSH_BIN = "/nonexistent/ssh";
    const r = await sshExec(T, "true");
    expect(r.code).toBe(127);
  });
});
```

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps-ssh` — Expected: FAIL (modul belum ada).

- [ ] **Step 7: Implementasi transport**

Di `server/src/runner/deps.ts`, tambahkan di bawah `resolveCliEntry`:

```ts
// SPEC-164: script vps dibaca dari <root>/server/scripts/vps — jangkar yang sama.
export const repoRoot = (startDir: string = process.cwd()): string => repoRootFrom(startDir);
```

Create `server/src/services/vps-ssh.ts`:

```ts
import { spawn } from "node:child_process";

// Test menunjuk HANOMAN_SSH_BIN ke fixture — pola HANOMAN_CLAUDE_BIN di pty.ts.
const sshBin = () => process.env.HANOMAN_SSH_BIN ?? "ssh";

export type SshTarget = { host: string; port: number; user: string; keyPath?: string | null };
export type SshResult = { code: number; out: string };

// BatchMode: tak pernah ada prompt password — koneksi hanoman selalu key-based, dan
// itulah yang membuat mematikan PasswordAuthentication aman bagi hanoman sendiri.
// accept-new: koneksi pertama merekam host key; key yang BERUBAH tetap ditolak (MITM).
export function sshExec(t: SshTarget, remoteCmd: string,
  opts: { stdin?: string; timeoutMs?: number } = {}): Promise<SshResult> {
  const args = [
    "-p", String(t.port), "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    ...(t.keyPath ? ["-i", t.keyPath] : []),
    `${t.user}@${t.host}`, remoteCmd,
  ];
  return new Promise((resolve) => {
    const p = spawn(sshBin(), args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    // ponytail: SIGKILL langsung — ssh yang menggantung melewati ConnectTimeout tak layak SIGTERM dulu.
    const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 60_000);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.stdin.on("error", () => {});   // proses mati sebelum stdin tertulis (unreachable) — bukan crash
    p.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: 127, out: String(e) }); });
    if (opts.stdin) p.stdin.write(opts.stdin);
    p.stdin.end();
  });
}
```

- [ ] **Step 8: Semua test hijau + commit**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test
git add server/src/services/vps-ssh.ts server/src/services/vps-audit.ts server/src/runner/deps.ts server/test/fixtures/fake-ssh.sh server/test/vps-audit.test.ts server/test/vps-ssh.test.ts
git commit --only server/src/services/vps-ssh.ts --only server/src/services/vps-audit.ts --only server/src/runner/deps.ts --only server/test/fixtures/fake-ssh.sh --only server/test/vps-audit.test.ts --only server/test/vps-ssh.test.ts -m "feat(server): transport ssh + parser audit/health VPS (SPEC-164)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Script bash — `audit.sh` + `harden.sh`

**Files:**
- Create: `server/scripts/vps/audit.sh`
- Create: `server/scripts/vps/harden.sh`
- Modify: `docs/superpowers/specs/2026-07-10-hanoman-vps-hardening-spec-164-design.md` (deviasi PermitRootLogin — lihat header plan)

**Interfaces:**
- Consumes: dijalankan remote via `sudo -n bash -s` (audit) dan `sudo -n env SSH_PORT=<port> SSH_USER=<user> bash -s` (harden).
- Produces: baris `CHECK <nama> <pass|fail|warn> <detail…>` (audit) dan `STEP <nama> <ok|fail> <detail…>` (harden). String `hanoman-audit` / `hanoman-harden` di header adalah marker yang dipakai `fake-ssh.sh` — jangan dihapus.

- [ ] **Step 1: audit.sh**

Create `server/scripts/vps/audit.sh` lalu `chmod +x`:

```bash
#!/usr/bin/env bash
# hanoman-audit · SPEC-164 — via `ssh <host> 'sudo -n bash -s' < audit.sh`.
# Output per baris: CHECK <nama> <pass|fail|warn> <detail…> — diparsing server/src/services/vps-audit.ts.
set -u
emit() { echo "CHECK $1 $2 ${3:-}"; }

# Script sampai sini artinya ssh+bash hidup; yang diverifikasi tinggal root/sudo.
if [ "$(id -u)" = 0 ]; then emit sudo_ok pass root
else emit sudo_ok fail "bukan root — beri passwordless sudo pada user ini"; fi

. /etc/os-release 2>/dev/null || true
FAM=""
case "${ID:-} ${ID_LIKE:-}" in
  *debian*|*ubuntu*) FAM=deb ;;
  *rhel*|*fedora*|*centos*|*rocky*|*alma*) FAM=rhel ;;
esac
if [ -n "$FAM" ]; then emit os_supported pass "${ID:-?} ${VERSION_ID:-?}"
else
  emit os_supported fail "${ID:-unknown} — hanya keluarga debian/rhel"
  exit 0   # check lain tak bermakna di distro asing
fi

# --- sshd: konfigurasi EFEKTIF (sshd -T), bukan berkas — drop-in & default ikut terbaca.
SSHD_T=$( (sshd -T 2>/dev/null || /usr/sbin/sshd -T 2>/dev/null) || true )
sshd_opt() { echo "$SSHD_T" | awk -v k="$1" '$1==k{print $2; exit}'; }
SSH_PORT=22
if [ -z "$SSHD_T" ]; then
  emit ssh_root_login fail "sshd -T gagal (butuh root)"
  emit ssh_password_auth fail "sshd -T gagal (butuh root)"
else
  v=$(sshd_opt permitrootlogin)
  case "$v" in
    no|prohibit-password) emit ssh_root_login pass "$v" ;;                # ADR-0024 §5
    *) emit ssh_root_login fail "PermitRootLogin ${v:-default}" ;;
  esac
  v=$(sshd_opt passwordauthentication)
  if [ "$v" = "no" ]; then emit ssh_password_auth pass
  else emit ssh_password_auth fail "PasswordAuthentication ${v:-default}"; fi
  p=$(sshd_opt port); SSH_PORT=${p:-22}
fi

# --- firewall
if [ "$FAM" = deb ]; then
  if ufw status 2>/dev/null | grep -q "Status: active"; then emit firewall pass "ufw active"
  else emit firewall fail "ufw tidak aktif"; fi
else
  if firewall-cmd --state 2>/dev/null | grep -q running; then emit firewall pass "firewalld running"
  else emit firewall fail "firewalld tidak jalan"; fi
fi

# --- fail2ban
if systemctl is-active --quiet fail2ban 2>/dev/null; then emit fail2ban pass aktif
else emit fail2ban fail "service tidak aktif"; fi

# --- auto security update
if [ "$FAM" = deb ]; then
  if grep -qs '"1"' /etc/apt/apt.conf.d/20auto-upgrades; then emit auto_updates pass "unattended-upgrades"
  else emit auto_updates fail "unattended-upgrades belum dikonfigurasi"; fi
else
  if systemctl is-enabled --quiet dnf-automatic.timer 2>/dev/null; then emit auto_updates pass "dnf-automatic.timer"
  else emit auto_updates fail "dnf-automatic.timer tidak aktif"; fi
fi

# --- warning-level
if timedatectl show -p NTP --value 2>/dev/null | grep -qi yes; then emit ntp pass aktif
else emit ntp warn "NTP tidak aktif — timedatectl set-ntp true"; fi

# Listener publik di luar {port SSH, 80, 443}. Loopback tak dihitung.
PORTS=$(ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E '^(0\.0\.0\.0|\[::\]|\*):' \
  | sed -E 's/.*:([0-9]+)$/\1/' | sort -un | grep -vE "^(${SSH_PORT}|80|443)$" \
  | tr '\n' ',' | sed 's/,$//')
if [ -n "$PORTS" ]; then emit open_ports warn "port publik tak terdaftar: $PORTS"
else emit open_ports pass; fi

if [ "$FAM" = deb ]; then
  N=$(apt-get -s upgrade 2>/dev/null | grep -c '^Inst.*[Ss]ecurity')
else
  N=$(dnf -q updateinfo list security 2>/dev/null | grep -c .)
fi
if [ "${N:-0}" -gt 0 ] 2>/dev/null; then emit pending_updates warn "$N security update tertunda"
else emit pending_updates pass; fi
```

- [ ] **Step 2: harden.sh**

Create `server/scripts/vps/harden.sh` lalu `chmod +x`:

```bash
#!/usr/bin/env bash
# hanoman-harden · SPEC-164 — idempotent; dijalankan HANYA lewat tombol Harden,
# via `ssh <host> 'sudo -n env SSH_PORT=<port> SSH_USER=<user> bash -s' < harden.sh`.
# Output: STEP <nama> <ok|fail> <detail…>. TIDAK membuat user, TIDAK mengganti port SSH,
# TIDAK menyentuh service custom — itu jalur sesi Claude (SPEC-164 §5).
set -u
SSH_PORT="${SSH_PORT:-22}"
step() { echo "STEP $1 $2 ${3:-}"; }

[ "$(id -u)" = 0 ] || { step precheck fail "bukan root"; exit 1; }
. /etc/os-release 2>/dev/null || true
case "${ID:-} ${ID_LIKE:-}" in
  *debian*|*ubuntu*) FAM=deb ;;
  *rhel*|*fedora*|*centos*|*rocky*|*alma*) FAM=rhel ;;
  *) step precheck fail "distro ${ID:-unknown} tidak didukung"; exit 1 ;;
esac
step precheck ok "$FAM ssh_port=$SSH_PORT"

pkg() { if [ "$FAM" = deb ]; then DEBIAN_FRONTEND=noninteractive apt-get -qq install -y "$@" >/dev/null 2>&1
        else dnf -q install -y "$@" >/dev/null 2>&1; fi; }
[ "$FAM" = deb ] && apt-get -qq update >/dev/null 2>&1

# 1 · firewall — allow port SSH DULU, baru enable (anti-lockout)
if [ "$FAM" = deb ]; then
  pkg ufw
  if ufw allow "$SSH_PORT/tcp" >/dev/null 2>&1 && ufw allow 80/tcp >/dev/null 2>&1 \
     && ufw allow 443/tcp >/dev/null 2>&1 && ufw --force enable >/dev/null 2>&1; then
    step firewall ok "ufw aktif, allow $SSH_PORT/80/443"
  else step firewall fail "ufw gagal"; fi
else
  pkg firewalld
  if systemctl enable --now firewalld >/dev/null 2>&1 \
     && firewall-cmd -q --permanent --add-port="$SSH_PORT/tcp" \
     && firewall-cmd -q --permanent --add-service=http \
     && firewall-cmd -q --permanent --add-service=https \
     && firewall-cmd -q --reload; then
    step firewall ok "firewalld aktif, allow $SSH_PORT/http/https"
  else step firewall fail "firewalld gagal"; fi
fi

# 2 · fail2ban
[ "$FAM" = rhel ] && pkg epel-release
if pkg fail2ban; then
  mkdir -p /etc/fail2ban/jail.d
  cat > /etc/fail2ban/jail.d/hanoman.conf <<'EOF'
[sshd]
enabled = true
maxretry = 3
bantime = 1h
findtime = 10m
EOF
  if systemctl enable --now fail2ban >/dev/null 2>&1 && systemctl restart fail2ban >/dev/null 2>&1; then
    step fail2ban ok
  else step fail2ban fail "service gagal start"; fi
else step fail2ban fail "instalasi gagal"; fi

# 3 · auto security update
if [ "$FAM" = deb ]; then
  if pkg unattended-upgrades; then
    printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' \
      > /etc/apt/apt.conf.d/20auto-upgrades
    step auto_updates ok "unattended-upgrades"
  else step auto_updates fail "instalasi gagal"; fi
else
  if pkg dnf-automatic && systemctl enable --now dnf-automatic.timer >/dev/null 2>&1; then
    step auto_updates ok "dnf-automatic.timer"
  else step auto_updates fail; fi
fi

# 4 · sshd — drop-in + sshd -t WAJIB pass sebelum reload (anti-lockout).
# User terkonfigurasi = root → prohibit-password (key-only), bukan `no`:
# `no` memutus akses hanoman sendiri (ADR-0024 §5).
ROOT_LOGIN=no
[ "${SSH_USER:-}" = root ] && ROOT_LOGIN=prohibit-password
mkdir -p /etc/ssh/sshd_config.d
grep -qE '^Include /etc/ssh/sshd_config.d' /etc/ssh/sshd_config 2>/dev/null \
  || sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
cat > /etc/ssh/sshd_config.d/99-hanoman.conf <<EOF
PermitRootLogin $ROOT_LOGIN
PasswordAuthentication no
MaxAuthTries 3
EOF
if sshd -t 2>/dev/null || /usr/sbin/sshd -t 2>/dev/null; then
  systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null
  step ssh ok "PermitRootLogin $ROOT_LOGIN · PasswordAuthentication no"
else
  rm -f /etc/ssh/sshd_config.d/99-hanoman.conf
  step ssh fail "sshd -t menolak konfigurasi — drop-in dibatalkan"
fi

# 5 · NTP
if timedatectl set-ntp true 2>/dev/null; then step ntp ok; else step ntp fail; fi
```

- [ ] **Step 3: Validasi sintaks**

```bash
bash -n server/scripts/vps/audit.sh && bash -n server/scripts/vps/harden.sh && echo SYNTAX-OK
command -v shellcheck >/dev/null && shellcheck -S warning server/scripts/vps/*.sh || echo "shellcheck tidak terpasang — lewati"
```

Expected: `SYNTAX-OK`; shellcheck tanpa error level warning+ (style boleh).

- [ ] **Step 4: Update spec (deviasi PermitRootLogin)**

Di file spec §3, ganti baris tabel `ssh_root_login`:
`| `ssh_root_login` | ya | `sshd -T`: `permitrootlogin no` |` →
`| `ssh_root_login` | ya | `sshd -T`: `permitrootlogin` `no`/`prohibit-password` |`
Di §5 poin 5, ganti `Set `PermitRootLogin no`` → `Set `PermitRootLogin no` (`prohibit-password` bila user terkonfigurasi = root — anti-lockout)`.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/vps/audit.sh server/scripts/vps/harden.sh docs/superpowers/specs/2026-07-10-hanoman-vps-hardening-spec-164-design.md
git commit --only server/scripts/vps --only docs/superpowers/specs/2026-07-10-hanoman-vps-hardening-spec-164-design.md -m "feat(server): script audit.sh + harden.sh VPS deb/rhel (SPEC-164)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Service `runAudit`/`runHealth` + route CRUD & audit

**Files:**
- Modify: `server/src/services/vps-audit.ts` (tambah `runAudit`, `runHealth`, `scriptPath`)
- Create: `server/src/routes/vps.ts` (CRUD + audit; harden/session menyusul Task 6–7)
- Modify: `server/src/app.ts` (register route)
- Test: `server/test/vps.route.test.ts` (create)

**Interfaces:**
- Consumes: `sshExec`/`SshTarget` (Task 3), parser (Task 3), `makeVps` (Task 1), fixture `fake-ssh.sh` (Task 3), `audit.sh` (Task 4).
- Produces:
  - `type VpsRow = { id: string; host: string; port: number; user: string; keyPath: string | null }`
  - `runAudit(v: VpsRow): Promise<{ ok: true; audit: VpsCheck[]; hardened: boolean } | { ok: false; out: string }>` — juga menulis `audit`/`lastAuditAt`/`hardened` ke DB
  - `runHealth(v: VpsRow): Promise<boolean>` — menulis `health`/`lastSeenAt` bila sukses
  - `scriptPath(f: string): string`
  - Route: `GET /api/vps`, `POST /api/vps` (201), `PATCH/DELETE /api/vps/:id`, `POST /api/vps/:id/audit`

- [ ] **Step 1: Test route — gagal dulu**

Create `server/test/vps.route.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp();
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("vps routes (SPEC-164)", () => {
  it("CRUD: create default port 22 → list → patch → delete", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps",
      payload: { name: "web-1", host: "203.0.113.10", user: "deploy" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().port).toBe(22);
    expect(res.json().hardened).toBe(false);
    const id = res.json().id as string;
    expect((await app.inject({ url: "/api/vps" })).json().length).toBe(1);
    const patch = await app.inject({ method: "PATCH", url: `/api/vps/${id}`, payload: { name: "web-1b" } });
    expect(patch.json().name).toBe("web-1b");
    expect(patch.json().port).toBe(22); // patch parsial tak mengubah field lain
    expect((await app.inject({ method: "DELETE", url: `/api/vps/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/vps/${id}` })).statusCode).toBe(404);
  });
  it("menolak host dengan metakarakter shell (400)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps",
      payload: { name: "x", host: "h; rm -rf /", user: "deploy" } });
    expect(res.statusCode).toBe(400);
  });
  it("audit menyimpan hasil + hardened true saat semua kritis pass", async () => {
    const v = await makeVps({ name: "a1", host: "198.51.100.1" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    expect(res.statusCode).toBe(200);
    expect(res.json().hardened).toBe(true);
    expect(res.json().audit.length).toBeGreaterThanOrEqual(7);
    const row = await prisma.vps.findUnique({ where: { id: v.id } });
    expect(row!.hardened).toBe(true);
    expect(row!.lastAuditAt).not.toBeNull();
  });
  it("check kritis fail → hardened false", async () => {
    process.env.FAKE_SSH_MODE = "audit-fail";
    const v = await makeVps({ name: "a2", host: "198.51.100.2" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    expect(res.json().hardened).toBe(false);
  });
  it("vps unreachable → 502 dengan output ssh, bukan 500", async () => {
    process.env.FAKE_SSH_MODE = "unreachable";
    const v = await makeVps({ name: "a3", host: "198.51.100.3" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    expect(res.statusCode).toBe(502);
    expect(res.json().out).toContain("Connection refused");
  });
  it("audit vps tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/vps/hantu/audit" })).statusCode).toBe(404);
  });
});
```

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps.route` — Expected: FAIL (route belum terdaftar → 404).

- [ ] **Step 2: `runAudit`/`runHealth` di service**

Tambahkan ke `server/src/services/vps-audit.ts` (di bawah `parseHealth`):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { repoRoot } from "../runner/deps";
import { sshExec, type SshTarget } from "./vps-ssh";
```

(gabungkan dengan import yang sudah ada di atas file), lalu:

```ts
export type VpsRow = { id: string; host: string; port: number; user: string; keyPath: string | null };
const target = (v: VpsRow): SshTarget => ({ host: v.host, port: v.port, user: v.user, keyPath: v.keyPath });
// Dijangkar ke root workspace (pola deps.ts) — benar dari tsx (cwd server/) maupun dist.
export const scriptPath = (f: string): string => join(repoRoot(), "server", "scripts", "vps", f);

export async function runAudit(v: VpsRow):
  Promise<{ ok: true; audit: VpsCheck[]; hardened: boolean } | { ok: false; out: string }> {
  const r = await sshExec(target(v), "sudo -n bash -s",
    { stdin: readFileSync(scriptPath("audit.sh"), "utf8"), timeoutMs: 60_000 });
  const audit = parseAudit(r.out);
  // ssh gagal ATAU output tanpa satu pun CHECK (sudo minta password, shell asing) = audit gagal.
  if (r.code !== 0 || audit.length === 0) return { ok: false, out: r.out };
  const hardened = isHardened(audit);
  await prisma.vps.update({ where: { id: v.id }, data: {
    audit: audit as unknown as Prisma.InputJsonValue, lastAuditAt: new Date(), hardened } });
  return { ok: true, audit, hardened };
}

export async function runHealth(v: VpsRow): Promise<boolean> {
  const r = await sshExec(target(v), HEALTH_CMD, { timeoutMs: 60_000 });
  const health = parseHealth(r.out);
  if (r.code !== 0 || !health) return false;
  await prisma.vps.update({ where: { id: v.id }, data: {
    health: health as unknown as Prisma.InputJsonValue, lastSeenAt: new Date() } });
  return true;
}
```

- [ ] **Step 3: Route + register**

Create `server/src/routes/vps.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { zCreateVps, zPatchVps } from "@hanoman/shared";
import { runAudit } from "../services/vps-audit";

// Audit (dan nanti harden/session) = eksekusi remote via SSH dengan key milik mesin ini.
// Tanpa auth — pagarnya bind 127.0.0.1 di server.ts, sama seperti /api/terminal
// (lihat komentar routes/terminal.ts). Bila HOST dibuka, gembok route ini bersamanya.
export default async function (app: FastifyInstance) {
  app.get("/vps", async () => prisma.vps.findMany({ orderBy: { createdAt: "asc" } }));

  app.post("/vps", async (req, reply) => {
    const p = zCreateVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    return reply.code(201).send(await prisma.vps.create({ data: p.data }));
  });

  app.patch("/vps/:id", async (req, reply) => {
    const p = zPatchVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try { return await prisma.vps.update({ where: { id: (req.params as { id: string }).id }, data: p.data }); }
    catch { return reply.code(404).send({ error: "not found" }); }
  });

  app.delete("/vps/:id", async (req, reply) => {
    try {
      await prisma.vps.delete({ where: { id: (req.params as { id: string }).id } });
      return reply.code(204).send();
    } catch { return reply.code(404).send({ error: "not found" }); }
  });

  app.post("/vps/:id/audit", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const r = await runAudit(v);
    if (!r.ok) return reply.code(502).send({ error: "audit gagal lewat ssh", out: r.out });
    return { audit: r.audit, hardened: r.hardened };
  });
}
```

Di `server/src/app.ts`: tambah `import vps from "./routes/vps";` (setelah import `terminal`) dan `await api.register(vps);` (setelah `await api.register(terminal);`).

- [ ] **Step 4: Test hijau**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test
```

Expected: PASS semua (termasuk suite lama).

- [ ] **Step 5: Smoke API nyata**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server dev &   # atau server yang sudah jalan
sleep 3
curl -s -X POST localhost:8787/api/vps -H 'content-type: application/json' \
  -d '{"name":"smoke","host":"192.0.2.1","user":"deploy"}'          # → 201, port 22
curl -s localhost:8787/api/vps                                       # → array berisi smoke
curl -s -X POST localhost:8787/api/vps/<id>/audit                    # → 502 (TEST-NET tak terjangkau) — jalur error bekerja
curl -s -X DELETE localhost:8787/api/vps/<id> -o /dev/null -w '%{http_code}'  # → 204
```

Catatan: audit smoke ke host TEST-NET memang 502 — yang diverifikasi: JSON error rapi, bukan 500/crash. (ConnectTimeout 10 dtk — curl audit butuh ±10 dtk.) Kalau kamu punya VPS sungguhan ber-key, boleh uji audit nyata di sini. Matikan server dev setelahnya bila kamu yang menyalakannya.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/vps-audit.ts server/src/routes/vps.ts server/src/app.ts server/test/vps.route.test.ts
git commit --only server/src/services/vps-audit.ts --only server/src/routes/vps.ts --only server/src/app.ts --only server/test/vps.route.test.ts -m "feat(server): route /vps CRUD + audit via ssh (SPEC-164)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Endpoint harden — apply → verifikasi koneksi → audit ulang

**Files:**
- Modify: `server/src/routes/vps.ts`
- Test: `server/test/vps.route.test.ts` (tambah describe)

**Interfaces:**
- Consumes: `sshExec` (Task 3), `runAudit`/`scriptPath` (Task 5), `harden.sh` (Task 4), fixture mode `verify-fail`.
- Produces: `POST /api/vps/:id/harden` → 200 `{ transcript, audit, hardened }` | 404 | 502 `{ error, transcript?, verify? }`.

- [ ] **Step 1: Test — gagal dulu** (tambahkan ke `server/test/vps.route.test.ts`)

```ts
describe("harden (SPEC-164)", () => {
  it("harden: transcript + verifikasi + audit ulang → hardened true", async () => {
    const v = await makeVps({ name: "h1", host: "198.51.100.11" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/harden` });
    expect(res.statusCode).toBe(200);
    expect(res.json().transcript).toContain("STEP ssh ok");
    expect(res.json().hardened).toBe(true);
    const row = await prisma.vps.findUnique({ where: { id: v.id } });
    expect(row!.hardened).toBe(true); // audit ulang otomatis tersimpan
  });
  it("ssh putus saat harden → 502, DB tak berubah", async () => {
    process.env.FAKE_SSH_MODE = "unreachable";
    const v = await makeVps({ name: "h2", host: "198.51.100.12" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/harden` });
    expect(res.statusCode).toBe(502);
    expect((await prisma.vps.findUnique({ where: { id: v.id } }))!.hardened).toBe(false);
  });
  it("verifikasi koneksi pasca-harden gagal → 502 dengan transcript", async () => {
    process.env.FAKE_SSH_MODE = "verify-fail";
    const v = await makeVps({ name: "h3", host: "198.51.100.13" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/harden` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("verifikasi");
    expect(res.json().transcript).toContain("STEP ssh ok"); // apply sempat jalan — transcript tetap dilaporkan
  });
  it("harden vps tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/vps/hantu/harden" })).statusCode).toBe(404);
  });
});
```

Run: FAIL (endpoint belum ada → 404 di test pertama).

- [ ] **Step 2: Implementasi** — tambahkan ke `server/src/routes/vps.ts`:

Import tambahan di header file:

```ts
import { readFileSync } from "node:fs";
import { sshExec } from "../services/vps-ssh";
import { runAudit, scriptPath } from "../services/vps-audit";
```

Handler (di bawah `POST /vps/:id/audit`):

```ts
  // Harden TIDAK PERNAH terjadwal — hanya dari tombol (SPEC-164 §5). Urutan anti-lockout:
  // apply (script sendiri allow port SSH sebelum enable firewall + sshd -t sebelum reload)
  // → verifikasi lewat KONEKSI BARU → audit ulang supaya status di list langsung jujur.
  app.post("/vps/:id/harden", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    // SSH_USER menentukan PermitRootLogin no vs prohibit-password; user/port sudah
    // divalidasi zod (trust boundary di zCreateVps), aman dirangkai ke perintah.
    const r = await sshExec(v, `sudo -n env SSH_PORT=${v.port} SSH_USER=${v.user} bash -s`,
      { stdin: readFileSync(scriptPath("harden.sh"), "utf8"), timeoutMs: 300_000 });
    if (r.code !== 0) return reply.code(502).send({ error: "harden gagal lewat ssh", transcript: r.out });
    const verify = await sshExec(v, "true", { timeoutMs: 30_000 });
    if (verify.code !== 0) {
      return reply.code(502).send({
        error: "verifikasi koneksi pasca-harden gagal — periksa akses ssh secara manual",
        transcript: r.out, verify: verify.out });
    }
    const audit = await runAudit(v);
    return { transcript: r.out, audit: audit.ok ? audit.audit : null, hardened: audit.ok && audit.hardened };
  });
```

- [ ] **Step 3: Test hijau**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps.route
```

- [ ] **Step 4: Smoke API nyata**

Boot server (bila belum), daftar VPS host TEST-NET seperti Task 5, lalu:

```bash
curl -s -X POST localhost:8787/api/vps/<id>/harden    # → 502 JSON rapi (unreachable), bukan 500
```

(Harden nyata hanya bila kamu punya VPS uji — opsional, jangan ke mesin produksi orang lain.)

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/vps.ts server/test/vps.route.test.ts
git commit --only server/src/routes/vps.ts --only server/test/vps.route.test.ts -m "feat(server): endpoint harden VPS — apply, verifikasi koneksi, audit ulang (SPEC-164)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Endpoint sesi Claude lanjutan

**Files:**
- Modify: `server/src/routes/vps.ts`
- Test: `server/test/vps.route.test.ts` (tambah describe)

**Interfaces:**
- Consumes: `createSession(projectId, cwd, opts)` + `killAll` dari `services/pty` (label owner `vps:<id>` — `nameOf` di TerminalScreen sudah fallback ke pid mentah, tak perlu diubah); `sessionModel()` dari `services/settings`; fixture `fake-claude.sh` yang sudah ada.
- Produces: `POST /api/vps/:id/session` → 201 `{ id }` | 404.

- [ ] **Step 1: Test — gagal dulu** (tambahkan ke `server/test/vps.route.test.ts`)

Import tambahan di header test: `import { getSession, killAll } from "../src/services/pty";` dan `const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));`

```ts
describe("sesi claude vps (SPEC-164)", () => {
  it("membuka sesi tmux dengan label owner vps:<id>", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const v = await makeVps({ name: "s1", host: "198.51.100.21",
      audit: [{ check: "firewall", status: "fail", detail: "ufw tidak aktif" }], lastAuditAt: new Date() });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/session` });
    expect(res.statusCode).toBe(201);
    const s = getSession(res.json().id);
    expect(s?.projectId).toBe(`vps:${v.id}`);
    killAll();
  });
  it("sesi vps tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/vps/hantu/session" })).statusCode).toBe(404);
  });
});
```

Run: FAIL (404 di test pertama).

- [ ] **Step 2: Implementasi** — tambahkan ke `server/src/routes/vps.ts`:

Import tambahan: `import { homedir } from "node:os";`, `import { createSession } from "../services/pty";`, `import { sessionModel } from "../services/settings";`, dan `import type { VpsCheck } from "@hanoman/shared";` (gabung ke import zod yang ada).

```ts
  // Escape hatch (SPEC-164 §6): kasus yang script tak tangani dikerjakan Claude interaktif.
  // cwd = home server (bukan repo siapa pun); konteks + perintah ssh dibawa prompt awal.
  app.post("/vps/:id/session", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const checks = (v.audit as VpsCheck[] | null) ?? [];
    const { model, effort } = await sessionModel();
    const s = createSession(`vps:${v.id}`, homedir(), {
      model, effort,
      prompt: [
        `Kamu membantu hardening lanjutan VPS "${v.name}" (${v.user}@${v.host} port ${v.port}).`,
        `Akses: ssh -p ${v.port}${v.keyPath ? ` -i ${v.keyPath}` : ""} ${v.user}@${v.host}`,
        checks.length ? "Hasil audit terakhir:" : "Belum pernah diaudit.",
        ...checks.map((c) => `- ${c.check}: ${c.status}${c.detail ? ` (${c.detail})` : ""}`),
        "Kerjakan hanya yang diminta lewat terminal ini; konfirmasi dulu sebelum perubahan berisiko.",
      ].join("\n"),
    });
    return reply.code(201).send({ id: s.id });
  });
```

- [ ] **Step 3: Test hijau + commit**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test
git add server/src/routes/vps.ts server/test/vps.route.test.ts
git commit --only server/src/routes/vps.ts --only server/test/vps.route.test.ts -m "feat(server): sesi claude lanjutan per-VPS (SPEC-164)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**JANGAN smoke endpoint ini dengan curl** — ia men-spawn claude sungguhan (lihat Global Constraints). Verifikasi nyata terjadi di Task 9 lewat UI, dengan sengaja dan sekali.

---

### Task 8: Monitor berkala — healthcheck 5 menit + audit harian

**Files:**
- Create: `server/src/services/vps-monitor.ts`
- Modify: `server/src/server.ts`
- Test: `server/test/vps-monitor.test.ts` (create)

**Interfaces:**
- Consumes: `runAudit`, `runHealth` (Task 5).
- Produces: `healthSweep(): Promise<void>`, `auditSweep(now?: () => number): Promise<void>`, `startVpsMonitor(): void`, `stopVpsMonitor(): void`. Loop HANYA dinyalakan `server.ts` — `buildApp()` tetap bebas timer, test tak tersentuh.

- [ ] **Step 1: Test sweep — gagal dulu**

Create `server/test/vps-monitor.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";
import { healthSweep, auditSweep } from "../src/services/vps-monitor";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("vps monitor (SPEC-164)", () => {
  it("healthSweep mengisi lastSeenAt + health untuk semua vps", async () => {
    const v = await makeVps({ name: "m1", host: "198.51.100.31" });
    await healthSweep();
    const row = await prisma.vps.findUnique({ where: { id: v.id } });
    expect(row!.lastSeenAt).not.toBeNull();
    expect((row!.health as { disk: string }).disk).toBe("42%");
  });
  it("healthSweep: vps unreachable dilewati tanpa melempar, lastSeenAt tetap", async () => {
    process.env.FAKE_SSH_MODE = "unreachable";
    const v = await makeVps({ name: "m2", host: "198.51.100.32" });
    await expect(healthSweep()).resolves.toBeUndefined();
    expect((await prisma.vps.findUnique({ where: { id: v.id } }))!.lastSeenAt).toBeNull();
  });
  it("auditSweep melewati vps yang lastAuditAt-nya masih segar", async () => {
    const fresh = await makeVps({ name: "m3", host: "198.51.100.33", lastAuditAt: new Date() });
    const stale = await makeVps({ name: "m4", host: "198.51.100.34" });
    await auditSweep();
    expect((await prisma.vps.findUnique({ where: { id: fresh.id } }))!.audit).toBeNull();  // dilewati
    expect((await prisma.vps.findUnique({ where: { id: stale.id } }))!.audit).not.toBeNull(); // diaudit
  });
});
```

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps-monitor` — FAIL (modul belum ada).

- [ ] **Step 2: Implementasi**

Create `server/src/services/vps-monitor.ts`:

```ts
import { prisma } from "../db";
import { runAudit, runHealth } from "./vps-audit";

const HEALTH_MS = 5 * 60_000;
const AUDIT_MS = 24 * 3_600_000;

// Sapuan serial — puluhan VPS pun rampung jauh sebelum tick berikutnya, tanpa badai
// ssh paralel. Gagal satu VPS tak menghentikan sisanya.
export async function healthSweep(): Promise<void> {
  for (const v of await prisma.vps.findMany()) await runHealth(v).catch(() => {});
}

export async function auditSweep(now: () => number = Date.now): Promise<void> {
  for (const v of await prisma.vps.findMany()) {
    if (v.lastAuditAt && now() - v.lastAuditAt.getTime() < AUDIT_MS) continue;
    await runAudit(v).catch(() => {});
  }
}

// Dipanggil server.ts saja — buildApp() bebas timer, test tak pernah menyentuh loop ini.
// Harden TIDAK pernah di sini (SPEC-164 §5): hanya audit & health yang terjadwal.
let timers: NodeJS.Timeout[] = [];
export function startVpsMonitor(): void {
  if (timers.length) return;
  const h = setInterval(() => void healthSweep(), HEALTH_MS);
  const a = setInterval(() => void auditSweep(), AUDIT_MS);
  h.unref(); a.unref(); timers = [h, a];
  // Pass pertama saat boot: dashboard segar tanpa menunggu tick; auditSweep sendiri
  // melewati yang lastAuditAt-nya < 24 jam.
  void healthSweep(); void auditSweep();
}
export function stopVpsMonitor(): void { for (const t of timers) clearInterval(t); timers = []; }
```

Di `server/src/server.ts`, jadikan:

```ts
import { buildApp } from "./app";
import { startVpsMonitor } from "./services/vps-monitor";
const app = buildApp();
const port = Number(process.env.PORT ?? 8787);
// Localhost secara default. hanoman tidak punya auth, dan /api/terminal menyerahkan
// PTY sungguhan — bind ke 0.0.0.0 berarti membagikan shell ke seluruh jaringan.
// Override lewat HOST hanya bila ada lapisan autentikasi di depannya.
const host = process.env.HOST ?? "127.0.0.1";
app.listen({ port, host }).then(() => {
  console.log(`hanoman api ${host}:${port}`);
  startVpsMonitor(); // healthcheck 5 menit + audit harian (SPEC-164)
});
```

- [ ] **Step 3: Test hijau**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test
```

- [ ] **Step 4: Smoke nyata**

Restart server dev; dalam log tak ada error; `curl -s localhost:8787/api/vps` — VPS TEST-NET yang tersisa tetap `lastSeenAt: null` (unreachable, sweep tak melempar). Server tetap hidup ±1 menit tanpa crash.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/vps-monitor.ts server/src/server.ts server/test/vps-monitor.test.ts
git commit --only server/src/services/vps-monitor.ts --only server/src/server.ts --only server/test/vps-monitor.test.ts -m "feat(server): monitor vps — healthcheck 5m + audit harian via setInterval (SPEC-164)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Frontend — api client, nav, VpsScreen

**Files:**
- Modify: `src/src/api/client.ts`
- Modify: `src/src/ds/shell.tsx` (item nav)
- Create: `src/src/screens/VpsScreen.tsx`
- Modify: `src/src/App.tsx` (section `vps`)
- Test: `src/test/vps-screen.test.tsx` (create)

**Interfaces:**
- Consumes: `paths.vps*` + `VpsView`/`VpsCheck` dari `@hanoman/shared` (Task 2); endpoint Task 5–7.
- Produces: `api.listVps/createVps/deleteVps/auditVps/hardenVps/vpsSession`; komponen `VpsScreen({ onToast, onGotoTerminal })`; helper murni `isReachable(v, now?)`, `hardenedLabel(v)` (diekspor untuk test).

- [ ] **Step 1: Test — gagal dulu**

Create `src/test/vps-screen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const VPS = {
  id: "v1", name: "web-1", host: "203.0.113.10", port: 22, user: "deploy", keyPath: null,
  createdAt: "2026-07-10T00:00:00Z", lastSeenAt: null, health: null,
  lastAuditAt: null, audit: null, hardened: false,
};
vi.mock("../src/api/client", () => ({
  api: { listVps: vi.fn(async () => [VPS]) },
  ApiError: class extends Error {},
}));
import { VpsScreen, isReachable, hardenedLabel } from "../src/screens/VpsScreen";

describe("VpsScreen (SPEC-164)", () => {
  it("badge: belum diaudit → unknown; audit ada → hardened/belum", () => {
    expect(hardenedLabel(VPS as never)).toBe("unknown");
    expect(hardenedLabel({ ...VPS, lastAuditAt: "2026-07-10T01:00:00Z", hardened: true } as never)).toBe("hardened");
    expect(hardenedLabel({ ...VPS, lastAuditAt: "2026-07-10T01:00:00Z", hardened: false } as never)).toBe("belum");
  });
  it("reachable = lastSeenAt < 10 menit (2× interval healthcheck)", () => {
    const now = Date.parse("2026-07-10T10:00:00Z");
    expect(isReachable({ ...VPS, lastSeenAt: "2026-07-10T09:55:00Z" } as never, now)).toBe(true);
    expect(isReachable({ ...VPS, lastSeenAt: "2026-07-10T09:45:00Z" } as never, now)).toBe(false);
    expect(isReachable(VPS as never, now)).toBe(false);
  });
  it("render daftar dari api", async () => {
    render(<VpsScreen onToast={() => {}} onGotoTerminal={() => {}} />);
    expect(await screen.findByText("web-1")).toBeTruthy();
    expect(screen.getByText("deploy@203.0.113.10")).toBeTruthy();
  });
});
```

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test vps-screen` — FAIL.

- [ ] **Step 2: api client**

Di `src/src/api/client.ts`: tambah `VpsView`/`VpsCheck` ke import shared (`import { paths, type ProjectView, type Spec, type Setting, type VpsView, type VpsCheck } from "@hanoman/shared";`) lalu di objek `api`:

```ts
  // SPEC-164 · modul VPS
  listVps: () => j<VpsView[]>(paths.vps),
  createVps: (b: { name: string; host: string; user: string; port?: number; keyPath?: string }) =>
    j<VpsView>(paths.vps, { method: "POST", ...body(b) }),
  deleteVps: (id: string) => j<void>(paths.vpsOne(id), { method: "DELETE" }),
  auditVps: (id: string) => j<{ audit: VpsCheck[]; hardened: boolean }>(paths.vpsAudit(id), { method: "POST" }),
  hardenVps: (id: string) => j<{ transcript: string; audit: VpsCheck[] | null; hardened: boolean }>(
    paths.vpsHarden(id), { method: "POST" }),
  vpsSession: (id: string) => j<{ id: string }>(paths.vpsSession(id), { method: "POST" }),
```

- [ ] **Step 3: Nav item**

Di `src/src/ds/shell.tsx`, dalam `HN_NAV`, sisipkan setelah baris `terminal`:

```ts
  { key: "vps", label: "VPS", icon: "server" },
```

- [ ] **Step 4: VpsScreen**

Create `src/src/screens/VpsScreen.tsx`:

```tsx
/* VpsScreen — daftar VPS: reachable/hardened, audit per check, tombol
   Audit / Harden / Sesi Claude (SPEC-164). Screen mandiri (pola SettingsScreen):
   memuat datanya sendiri, App hanya memasang Shell. */
import React from "react";
import { Button, Modal, Field, Input, StateBlock, Icon } from "../ds";
import { api } from "../api/client";
import type { VpsView, VpsCheck } from "@hanoman/shared";

// reachable = healthcheck terakhir sukses dalam 2× interval 5 menit (SPEC-164 §4).
export const isReachable = (v: VpsView, now: number = Date.now()): boolean =>
  !!v.lastSeenAt && now - new Date(v.lastSeenAt).getTime() < 10 * 60_000;
export const hardenedLabel = (v: VpsView): "hardened" | "belum" | "unknown" =>
  !v.lastAuditAt ? "unknown" : v.hardened ? "hardened" : "belum";

const TONE = {
  hardened: { bg: "var(--ok-soft, #e7f2e7)", fg: "var(--ok, #2e7d32)" },
  belum: { bg: "var(--warn-soft, #fdecea)", fg: "var(--danger, #b3261e)" },
  unknown: { bg: "var(--bone-100)", fg: "var(--text-subtle)" },
} as const;
function Chip({ label, tone }: { label: string; tone: keyof typeof TONE }) {
  const t = TONE[tone];
  return <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", padding: "2px 8px",
    borderRadius: 999, background: t.bg, color: t.fg }}>{label}</span>;
}

const CHECK_ICON = { pass: "check", fail: "x", warn: "alert-triangle" } as const;
function CheckRow({ c }: { c: VpsCheck }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 0",
      borderBottom: "1px solid var(--border-hair)", fontSize: 13 }}>
      <Icon name={CHECK_ICON[c.status]} size={14}
        color={c.status === "pass" ? "var(--ok, #2e7d32)" : c.status === "fail" ? "var(--danger, #b3261e)" : "var(--brass-700)"} />
      <span style={{ fontFamily: "var(--font-mono)" }}>{c.check}</span>
      <span style={{ color: "var(--text-subtle)", fontSize: 12 }}>{c.detail}</span>
    </div>
  );
}

type VpsForm = { name: string; host: string; user: string; port: string; keyPath: string };
function NewVpsModal({ open, onClose, onCreate }:
  { open: boolean; onClose: () => void; onCreate: (f: VpsForm) => void }) {
  const blank: VpsForm = { name: "", host: "", user: "", port: "22", keyPath: "" };
  const [f, setF] = React.useState(blank);
  React.useEffect(() => { if (open) setF(blank); }, [open]);
  const set = (k: keyof VpsForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const canSubmit = !!(f.name.trim() && f.host.trim() && f.user.trim());
  return (
    <Modal open={open} onClose={onClose} icon="server" eyebrow="infra" title="Daftarkan VPS"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" onClick={() => canSubmit && onCreate(f)}>Daftarkan</Button>
      </>}>
      <Field label="Nama"><Input value={f.name} onChange={set("name")} placeholder="mis. web-1" style={{ width: "100%" }} /></Field>
      <Field label="Host" hint="hostname atau IP — tanpa user@">
        <Input value={f.host} onChange={set("host")} mono placeholder="203.0.113.10" style={{ width: "100%" }} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <Field label="User SSH" hint="root atau user ber-passwordless-sudo">
          <Input value={f.user} onChange={set("user")} mono placeholder="deploy" style={{ width: "100%" }} /></Field>
        <Field label="Port"><Input value={f.port} onChange={set("port")} mono style={{ width: "100%" }} /></Field>
      </div>
      <Field label="Key path" hint="opsional — kosong berarti key/agent default mesin server">
        <Input value={f.keyPath} onChange={set("keyPath")} mono placeholder="~/.ssh/id_ed25519" style={{ width: "100%" }} /></Field>
    </Modal>
  );
}

export function VpsScreen({ onToast, onGotoTerminal }:
  { onToast: (msg: string, kind?: string, icon?: string) => void; onGotoTerminal: () => void }) {
  const [list, setList] = React.useState<VpsView[]>([]);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [sel, setSel] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null); // "<aksi>:<id>"
  const [modal, setModal] = React.useState(false);

  const load = React.useCallback(() => {
    api.listVps().then((l) => { setList(l); setStatus("ready"); })
      .catch(() => setStatus("error"));
  }, []);
  React.useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // status reachable/hardened tetap segar tanpa klik
    return () => clearInterval(t);
  }, [load]);

  async function run(label: string, id: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(`${label}:${id}`);
    try { await fn(); load(); onToast(okMsg, "ok", "server"); }
    catch { onToast(`Gagal ${label}`, "err", "x-circle"); }
    finally { setBusy(null); }
  }
  const audit = (v: VpsView) => run("audit", v.id, () => api.auditVps(v.id), `${v.name} · audit selesai`);
  function harden(v: VpsView) {
    // window.confirm cukup (pola deleteProject di App): sebut persis apa yang berubah.
    if (!window.confirm(
      `Harden "${v.name}"?\n\nYang diterapkan: firewall (allow ${v.port}/80/443), fail2ban, ` +
      `auto security update, PermitRootLogin & PasswordAuthentication off, NTP.\n` +
      `Pastikan akses key SSH non-password kamu sudah bekerja.`)) return;
    void run("harden", v.id, () => api.hardenVps(v.id), `${v.name} · harden selesai`);
  }
  const session = (v: VpsView) =>
    run("sesi", v.id, async () => { await api.vpsSession(v.id); onGotoTerminal(); }, `${v.name} · sesi Claude dibuka`);
  async function remove(v: VpsView) {
    if (!window.confirm(`Hapus registrasi VPS "${v.name}"? Server-nya sendiri tak disentuh.`)) return;
    await api.deleteVps(v.id).then(load).catch(() => onToast("Gagal hapus", "err", "x-circle"));
  }

  if (status === "loading") return <StateBlock kind="loading" title="Memuat daftar VPS…" />;
  if (status === "error") return <StateBlock kind="error" title="Gagal memuat daftar VPS"
    hint="Pastikan server hanoman berjalan." action={load} />;
  if (list.length === 0) return (
    <>
      <StateBlock kind="empty" icon="server" title="Belum ada VPS"
        hint="Daftarkan VPS untuk mulai audit & hardening." action={() => setModal(true)} actionLabel="Daftarkan VPS" />
      <NewVpsModal open={modal} onClose={() => setModal(false)} onCreate={create} />
    </>
  );

  async function create(f: VpsForm) {
    try {
      const v = await api.createVps({ name: f.name.trim(), host: f.host.trim(), user: f.user.trim(),
        port: Number(f.port) || 22, keyPath: f.keyPath.trim() || undefined });
      setModal(false); load();
      onToast(`${v.name} terdaftar · jalankan audit`, "ok", "server");
    } catch { onToast("Gagal mendaftarkan VPS — cek format host/user", "err", "x-circle"); }
  }

  const selected = list.find((v) => v.id === sel);
  return (
    <div style={{ display: "grid", gridTemplateColumns: selected ? "1.4fr 1fr" : "1fr", gap: 16 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <Button size="sm" leftIcon="plus" onClick={() => setModal(true)}>Daftarkan VPS</Button>
        </div>
        {list.map((v) => (
          <div key={v.id} onClick={() => setSel(v.id === sel ? null : v.id)}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", cursor: "pointer",
              border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", marginBottom: 8,
              background: v.id === sel ? "var(--bone-100)" : "transparent" }}>
            <Icon name="server" size={16} color="var(--brass-700)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{v.name}</div>
              <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}>
                {v.user}@{v.host}{v.port !== 22 ? `:${v.port}` : ""}</div>
            </div>
            <Chip label={isReachable(v) ? "reachable" : "unreachable"} tone={isReachable(v) ? "hardened" : "unknown"} />
            <Chip label={hardenedLabel(v) === "unknown" ? "belum diaudit" : hardenedLabel(v)} tone={hardenedLabel(v)} />
            <Button size="sm" variant="secondary" leftIcon="radar" disabled={busy === `audit:${v.id}`}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); void audit(v); }}>Audit</Button>
            <Button size="sm" leftIcon="shield" disabled={busy === `harden:${v.id}`}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); harden(v); }}>Harden</Button>
            <Button size="sm" variant="ghost" leftIcon="terminal" disabled={busy === `sesi:${v.id}`}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); void session(v); }}>Sesi Claude</Button>
            <Button size="sm" variant="ghost" leftIcon="trash-2"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); void remove(v); }} />
          </div>
        ))}
      </div>
      {selected && (
        <div style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{selected.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-subtle)", marginBottom: 10 }}>
            {selected.lastAuditAt
              ? `Audit terakhir ${new Date(selected.lastAuditAt).toLocaleString()}`
              : "Belum pernah diaudit"}
            {selected.health && ` · disk ${selected.health.disk} · mem ${selected.health.mem} · load ${selected.health.load}`}
          </div>
          {(selected.audit ?? []).map((c) => <CheckRow key={c.check} c={c} />)}
          {!selected.audit && <StateBlock kind="empty" compact icon="radar" title="Belum ada hasil audit"
            hint="Jalankan Audit untuk melihat status per check." />}
        </div>
      )}
      <NewVpsModal open={modal} onClose={() => setModal(false)} onCreate={create} />
    </div>
  );
}
```

Catatan implementasi: sesuaikan pemakaian komponen dengan API nyata `src/src/ds` (cek `kit.tsx` untuk prop `Button`/`StateBlock`/`Modal` — bila `StatusPill` di kit ternyata cocok untuk Chip, pakai itu dan hapus `Chip`). Var CSS `--ok`/`--danger` — cek `tokens/`; bila tak ada, pakai fallback yang tertulis.

- [ ] **Step 5: Wiring App**

Di `src/src/App.tsx`: `import { VpsScreen } from "./screens/VpsScreen";` lalu tambah cabang setelah blok `terminal`:

```tsx
  } else if (section === "vps") {
    screen = (
      <Shell active="vps" title="VPS" breadcrumb="infra · audit → harden" onNavigate={setSection}>
        <VpsScreen onToast={showToast} onGotoTerminal={() => setSection("terminal")} />
      </Shell>
    );
```

- [ ] **Step 6: Test hijau + typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src test
pnpm -r typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/src/api/client.ts src/src/ds/shell.tsx src/src/screens/VpsScreen.tsx src/src/App.tsx src/test/vps-screen.test.tsx
git commit --only src/src/api/client.ts --only src/src/ds/shell.tsx --only src/src/screens/VpsScreen.tsx --only src/src/App.tsx --only src/test/vps-screen.test.tsx -m "feat(web): screen VPS — daftar, audit, harden, sesi claude (SPEC-164)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Verifikasi end-to-end + rapikan docs

**Files:**
- Modify: `docs/superpowers/plans/2026-07-10-hanoman-vps-hardening-spec-164.md` (checklist)
- Modify: `internal/docs/architecture/*` HANYA bila ada indeks modul/route yang menyebut daftar route API (periksa dulu; kalau tidak ada, lewati — jangan membuat dokumen baru).

- [ ] **Step 1: Suite penuh**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm -r test
pnpm -r typecheck
```

Expected: hijau. (Ingat memori repo: `queue-durability` dkk. sudah dihapus bersama SPEC-162; kalau ada test lama yang gagal dan TIDAK menyentuh file vps, itu bukan milik task ini — laporkan, jangan "perbaiki" membabi-buta.)

- [ ] **Step 2: Smoke UI nyata (CDP)**

Boot server + `pnpm --filter ./src dev`. Buka lewat Chrome headless/CDP (pola memori `hanoman-browser-smoke-via-cdp`): klik nav VPS → daftarkan VPS TEST-NET → badge `unreachable` + `belum diaudit` muncul → klik Audit → toast gagal (502) tampil rapi. Bila kamu punya VPS uji sungguhan: audit nyata → panel check terisi; TIDAK mengklik Harden/Sesi Claude ke mesin yang bukan milikmu.

- [ ] **Step 3: Centang checklist plan + commit penutup**

```bash
git add docs/superpowers/plans/2026-07-10-hanoman-vps-hardening-spec-164.md
git commit --only docs/superpowers/plans/2026-07-10-hanoman-vps-hardening-spec-164.md -m "docs(spec-164): centang checklist implementasi modul VPS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
