# VPS harden fail2ban backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Setelah Harden, service `fail2ban` benar-benar aktif di keluarga RHEL/OpenCloudOS (bukan hanya terpasang).

**Architecture:** Pin `backend = systemd` di jail `[sshd]` yang ditulis `harden.sh` supaya fail2ban membaca journald dan start andal tanpa bergantung `/var/log/secure`. Satu baris di heredoc; kontrak `STEP`/`CHECK` tak berubah.

**Tech Stack:** bash (script deterministik VPS), vitest (assert statis), Fastify (endpoint vps — tak disentuh).

## Global Constraints

- Harden.sh tak dijalankan penuh di CI (butuh root + memutasi sistem) — verifikasi lewat assert statis, pola SPEC-183. Ceiling ini disengaja.
- Semua distro yang didukung memakai systemd → `backend = systemd` aman lintas distro; non-regresif di deb (sudah default via `defaults-debian.conf`).
- Update SoT `internal/docs/adr/0025-modul-vps-script-deterministik.md` dalam commit yang sama.

---

### Task 1: Pin fail2ban `backend = systemd` di jail sshd harden.sh

**Files:**
- Modify: `server/scripts/vps/harden.sh:50-56` (heredoc `hanoman.conf`)
- Test: `server/test/vps-os-family.test.ts` (tambah assert statis)
- Modify: `internal/docs/adr/0025-modul-vps-script-deterministik.md` (konsekuensi fail2ban)

**Interfaces:**
- Consumes: kontrak `STEP fail2ban ok|fail` (tak berubah).
- Produces: tak ada API baru; jail sshd kini memuat `backend = systemd`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `describe("deteksi keluarga OS (SPEC-183)", …)` di `server/test/vps-os-family.test.ts`:

```ts
it("harden.sh mem-pin backend = systemd untuk jail sshd (SPEC-190)", () => {
  // fail2ban di RHEL/OpenCloudOS journald-only gagal start dengan backend file default
  // (/var/log/secure tak ada). backend=systemd bikin service aktif setelah harden.
  const harden = readFileSync(join(vpsDir, "harden.sh"), "utf8");
  expect(harden).toMatch(/\[sshd\][\s\S]*?backend = systemd/);
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/vps-os-family.test.ts`
Expected: FAIL pada test SPEC-190 (`backend = systemd` belum ada di harden.sh).

- [x] **Step 3: Terapkan fix minimal**

Di `server/scripts/vps/harden.sh`, ubah heredoc jail sshd (blok §2):

```bash
  cat > /etc/fail2ban/jail.d/hanoman.conf <<'EOF'
[sshd]
enabled = true
# backend=systemd: baca journald, bukan /var/log/secure. Di RHEL/OpenCloudOS
# journald-only berkas itu belum ada → jail sshd gagal konfigurasi → service mati.
backend = systemd
maxretry = 3
bantime = 1h
findtime = 10m
EOF
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/vps-os-family.test.ts`
Expected: PASS semua (termasuk regresi opencloudos/ubuntu/arch).

- [x] **Step 5: Update SoT ADR-0025**

Di `internal/docs/adr/0025-modul-vps-script-deterministik.md`, pada bagian Konsekuensi (baris distro/fail2ban), tambahkan catatan bahwa jail sshd memakai `backend = systemd` agar fail2ban start andal di RHEL/OpenCloudOS journald-only (SPEC-190).

- [x] **Step 6: Verifikasi tak ada regresi lapisan TS + boot/curl**

Run: `cd server && env -u NODE_ENV -u DATABASE_URL pnpm vitest run test/vps.route.test.ts test/vps-audit.test.ts test/vps-os-family.test.ts`
Expected: PASS. Lalu boot server terhadap DB throwaway + curl endpoint vps (GET /api/vps) untuk memastikan route hidup (harden butuh VPS nyata; cukup pastikan lapisan TS tak error).

- [x] **Step 7: Commit**

```bash
git add server/scripts/vps/harden.sh server/test/vps-os-family.test.ts \
  internal/docs/adr/0025-modul-vps-script-deterministik.md \
  docs/superpowers/specs/2026-07-11-hanoman-vps-fail2ban-backend-spec-190-design.md \
  docs/superpowers/plans/2026-07-11-hanoman-vps-fail2ban-backend-spec-190.md
git commit -m "fix(vps): fail2ban backend=systemd agar service aktif pasca-harden (SPEC-190)"
```
