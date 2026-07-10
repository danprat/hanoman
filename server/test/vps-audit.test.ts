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
