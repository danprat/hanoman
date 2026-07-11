# SPEC-183 — Support VPS Harden OpenCloudOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hanoman meng-audit & men-harden VPS ber-OS OpenCloudOS dengan jalur yang sama seperti RHEL-family.

**Architecture:** Deteksi OS ada hanya di dua script bash deterministik (`server/scripts/vps/{harden,audit}.sh`); lapisan TypeScript tak menyentuh distro. OpenCloudOS = turunan RHEL (dnf/firewalld/systemd/dnf-automatic) tapi os-release-nya `ID_LIKE=opencloudos` (self-referential) sehingga lolos deteksi keluarga. Perbaikan: tambah pola `*opencloudos*` ke cabang `FAM=rhel`, dan pasang `epol-release` (padanan EPEL milik OpenCloudOS) agar `fail2ban` teresolusi.

**Tech Stack:** bash, vitest (child_process), TypeScript. Tak ada perubahan skema/API/frontend.

**Spec:** `docs/superpowers/specs/2026-07-11-hanoman-vps-harden-opencloudos-spec-183-design.md`

## Global Constraints

- **Shell sesi menunjuk prod:** jalankan SEMUA pnpm/prisma dengan `env -u NODE_ENV -u DATABASE_URL` (env sesi `NODE_ENV=production` + `hanoman_prod` bikin ±41 test gagal palsu).
- **Worktree dipakai sesi lain bersamaan:** JANGAN `git add -A`/`git add .`/`git stash`. Commit hanya `git add <path eksplisit>` file yang kamu ubah; cek `git status --short` dulu.
- Deteksi OS identik di KEDUA script — setiap edit pola distro harus diterapkan ke `harden.sh` DAN `audit.sh`.
- Komentar kode bahasa Indonesia, gaya padat seperti file tetangga.
- Test server: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test`. Typecheck: `pnpm -r typecheck`.
- Update docs yang tersentuh (SoT) dalam commit yang sama.
- Commit message gaya repo (`feat(vps): … (SPEC-183)`), diakhiri baris kosong lalu `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Dukung OpenCloudOS di script harden/audit + test

**Files:**
- Modify: `server/scripts/vps/harden.sh` (deteksi keluarga + repo fail2ban)
- Modify: `server/scripts/vps/audit.sh` (deteksi keluarga + pesan)
- Create: `server/test/vps-os-family.test.ts`
- Create: `server/test/fixtures/os-release-opencloudos`
- Create: `server/test/fixtures/os-release-ubuntu`
- Create: `server/test/fixtures/os-release-arch`
- Modify: `internal/docs/adr/0025-modul-vps-script-deterministik.md` (baris konsekuensi)

**Interfaces:**
- Produces: knob env `HANOMAN_OS_RELEASE` (default `/etc/os-release`) di kedua script — hanya untuk test; tak dipakai kode lain.

- [x] **Step 1: Tambah knob os-release ke kedua script (enable test)**

Di `server/scripts/vps/harden.sh`, ganti baris `. /etc/os-release 2>/dev/null || true` menjadi:

```sh
# ponytail: path overridable HANYA untuk test (fixture os-release); default = /etc/os-release
. "${HANOMAN_OS_RELEASE:-/etc/os-release}" 2>/dev/null || true
```

Lakukan penggantian identik di `server/scripts/vps/audit.sh`.

- [x] **Step 2: Buat fixture os-release**

`server/test/fixtures/os-release-opencloudos`:

```sh
NAME="OpenCloudOS"
ID="opencloudos"
ID_LIKE="opencloudos"
VERSION_ID="9.2"
PLATFORM_ID="platform:oc9"
```

`server/test/fixtures/os-release-ubuntu`:

```sh
NAME="Ubuntu"
ID=ubuntu
ID_LIKE=debian
VERSION_ID="24.04"
```

`server/test/fixtures/os-release-arch`:

```sh
NAME="Arch Linux"
ID=arch
```

- [x] **Step 3: Tulis test yang gagal**

`server/test/vps-os-family.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const vpsDir = join(__dirname, "..", "scripts", "vps");
const fixture = (name: string) => join(__dirname, "fixtures", `os-release-${name}`);

// Jalankan audit.sh sungguhan (non-root) dengan os-release yang disuntik.
function audit(osRelease: string): string {
  return execFileSync("bash", [join(vpsDir, "audit.sh")], {
    env: { ...process.env, HANOMAN_OS_RELEASE: osRelease },
    encoding: "utf8",
  });
}

describe("deteksi keluarga OS (SPEC-183)", () => {
  it("OpenCloudOS didukung dan mengambil cabang RHEL", () => {
    const out = audit(fixture("opencloudos"));
    expect(out).toMatch(/CHECK os_supported pass opencloudos/);
    // Cabang RHEL memakai dnf-automatic; cabang deb memakai unattended-upgrades.
    expect(out).toMatch(/CHECK auto_updates \w+ .*dnf-automatic/);
  });

  it("Ubuntu tetap didukung lewat cabang deb (regresi)", () => {
    const out = audit(fixture("ubuntu"));
    expect(out).toMatch(/CHECK os_supported pass ubuntu/);
    expect(out).toMatch(/CHECK auto_updates \w+ .*unattended-upgrades/);
  });

  it("distro asing ditolak", () => {
    const out = audit(fixture("arch"));
    expect(out).toMatch(/CHECK os_supported fail/);
  });

  it("harden.sh memuat perbaikan yang sama (deteksi + repo EPOL)", () => {
    // harden.sh butuh root + memutasi sistem → tak dijalankan; cek statis blok deteksi.
    const harden = readFileSync(join(vpsDir, "harden.sh"), "utf8");
    expect(harden).toMatch(/\*opencloudos\*\)\s*FAM=rhel/);
    expect(harden).toContain("epol-release");
  });
});
```

- [x] **Step 4: Jalankan test — pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps-os-family`
Expected: FAIL — kasus opencloudos memberi `os_supported fail` (pola belum ditambah), dan kasus harden.sh gagal (belum ada `epol-release`).

- [x] **Step 5: Tambah OpenCloudOS ke deteksi keluarga (kedua script)**

Di `server/scripts/vps/harden.sh`, cabang rhel:

```sh
  *rhel*|*fedora*|*centos*|*rocky*|*alma*|*opencloudos*) FAM=rhel ;;
```

Di `server/scripts/vps/audit.sh`, cabang rhel yang sama:

```sh
  *rhel*|*fedora*|*centos*|*rocky*|*alma*|*opencloudos*) FAM=rhel ;;
```

Dan perbarui pesan tolak di `audit.sh`:

```sh
  emit os_supported fail "${ID:-unknown} — hanya keluarga debian/rhel/opencloudos"
```

- [x] **Step 6: fail2ban via EPOL untuk OpenCloudOS (harden.sh)**

Di `server/scripts/vps/harden.sh`, ganti baris `[ "$FAM" = rhel ] && pkg epel-release` menjadi:

```sh
# fail2ban di RHEL-family butuh repo tambahan: EPEL, kecuali OpenCloudOS yang
# memakai EPOL (epel-release tak ada di sana). Best-effort — gagal tak fatal.
if [ "$FAM" = rhel ]; then
  if [ "${ID:-}" = opencloudos ]; then pkg epol-release; else pkg epel-release; fi
fi
```

- [x] **Step 7: Jalankan test — pastikan HIJAU**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test vps-os-family`
Expected: PASS (4 test).

- [x] **Step 8: Update SoT (ADR-0025)**

Di `internal/docs/adr/0025-modul-vps-script-deterministik.md`, ganti baris konsekuensi:

```md
- Distro di luar debian/rhel-family ditolak eksplisit (`os_supported` fail).
```

menjadi:

```md
- Distro didukung: debian/ubuntu, keluarga RHEL, dan OpenCloudOS (dideteksi via
  `ID=opencloudos` eksplisit karena `ID_LIKE`-nya self-referential; diperlakukan
  sebagai RHEL, fail2ban dari repo EPOL — SPEC-183). Distro lain ditolak eksplisit
  (`os_supported` fail).
```

- [x] **Step 9: Regresi penuh + typecheck**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter ./server test`
Expected: seluruh suite server hijau (khususnya `vps-audit`, `vps.route`).
Run: `pnpm -r typecheck`
Expected: tanpa error.

- [x] **Step 10: Commit**

```bash
git add server/scripts/vps/harden.sh server/scripts/vps/audit.sh \
  server/test/vps-os-family.test.ts server/test/fixtures/os-release-opencloudos \
  server/test/fixtures/os-release-ubuntu server/test/fixtures/os-release-arch \
  internal/docs/adr/0025-modul-vps-script-deterministik.md \
  docs/superpowers/specs/2026-07-11-hanoman-vps-harden-opencloudos-spec-183-design.md \
  docs/superpowers/plans/2026-07-11-hanoman-vps-harden-opencloudos-spec-183.md
git status --short   # pastikan HANYA file di atas ter-stage
git commit -m "$(cat <<'EOF'
feat(vps): dukung harden/audit OpenCloudOS sebagai RHEL-family (SPEC-183)

OpenCloudOS punya ID_LIKE self-referential sehingga lolos deteksi keluarga;
tambah pola *opencloudos* eksplisit + fail2ban via repo EPOL (bukan EPEL).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

## Self-Review

- **Spec coverage:** deteksi opencloudos (Step 5) ✓; fail2ban EPOL (Step 6) ✓; knob test (Step 1) ✓; verifikasi fixture opencloudos/ubuntu/arch (Step 3) ✓; assert harden statis (Step 3) ✓; SoT ADR-0025 (Step 8) ✓; non-goal (tanpa perubahan skema/API) dijaga ✓.
- **Placeholder scan:** tak ada TBD/TODO; semua langkah punya kode/perintah nyata.
- **Type consistency:** knob `HANOMAN_OS_RELEASE` dipakai konsisten di kedua script & test; pola `*opencloudos*) FAM=rhel` identik di dua tempat.
