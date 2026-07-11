import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const vpsDir = join(import.meta.dirname, "..", "scripts", "vps");
const fixture = (name: string) => join(import.meta.dirname, "fixtures", `os-release-${name}`);

// Jalankan audit.sh sungguhan (non-root) dengan os-release yang disuntik lewat knob.
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

  it("harden.sh mem-pin backend = systemd untuk jail sshd (SPEC-190)", () => {
    // fail2ban di RHEL/OpenCloudOS journald-only gagal start dengan backend file default
    // (/var/log/secure tak ada). backend=systemd bikin service aktif setelah harden.
    const harden = readFileSync(join(vpsDir, "harden.sh"), "utf8");
    expect(harden).toMatch(/\[sshd\][\s\S]*?backend = systemd/);
  });
});
