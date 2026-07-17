import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseSteps } from "../src/services/vps-remediate";
import { CATALOG } from "../src/vps/catalog/catalog";

const vpsDir = join(import.meta.dirname, "..", "scripts", "vps");
const fixture = join(import.meta.dirname, "fixtures", "os-release-ubuntu");

// Jalankan remediate.sh sungguhan (non-root) dgn os-release disuntik. Dry-run & item non-AUTO
// tak menyentuh tool linux, jadi aman dijalankan di mac.
function run(items: string, dryRun: boolean): string {
  return execFileSync("bash", [join(vpsDir, "remediate.sh")], {
    env: { ...process.env, HANOMAN_OS_RELEASE: fixture, ITEMS: items, DRY_RUN: dryRun ? "1" : "", SSH_PORT: "22" },
    encoding: "utf8",
  });
}

describe("parseSteps (SPEC-220)", () => {
  it("mem-parse would/ok/fail, abaikan noise", () => {
    const steps = parseSteps("motd\nSTEP fw-b1 would akan\nSTEP ker-b1 ok\nSTEP usr-b2 fail bukan AUTO\n");
    expect(steps).toEqual([
      { item: "fw-b1", status: "would", detail: "akan" },
      { item: "ker-b1", status: "ok", detail: "" },
      { item: "usr-b2", status: "fail", detail: "bukan AUTO" },
    ]);
  });
});

describe("remediate.sh (SPEC-220)", () => {
  it("dry-run: semua item AUTO → would, TIDAK ada ok (AC-13)", () => {
    const steps = parseSteps(run("fw-b1,ker-b1,ssh-i5", true));
    expect(steps.map((s) => s.item).sort()).toEqual(["fw-b1", "ker-b1", "ssh-i5"]);
    expect(steps.every((s) => s.status === "would")).toBe(true);
    expect(steps.some((s) => s.status === "ok")).toBe(false);
  });

  it("item non-AUTO ditolak → fail 'bukan item AUTO' (AC-16)", () => {
    const steps = parseSteps(run("usr-b2,ssh-b2", true)); // usr-b2 INFO, ssh-b2 AUDIT
    expect(steps.every((s) => s.status === "fail")).toBe(true);
    expect(steps.find((s) => s.item === "ssh-b2")?.detail).toContain("bukan item AUTO");
  });

  it("daftar AUTO di skrip = item remediable di katalog (tak ada divergensi)", () => {
    // dry-run SEMUA item remediable → semua harus `would` (dikenal skrip sbagai AUTO)
    const remediable = CATALOG.filter((c) => c.remediable).map((c) => c.id);
    const steps = parseSteps(run(remediable.join(","), true));
    expect(steps.filter((s) => s.status === "would").map((s) => s.item).sort()).toEqual([...remediable].sort());
  });
});
