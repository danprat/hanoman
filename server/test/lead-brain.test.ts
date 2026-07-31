import { describe, it, expect, afterEach } from "vitest";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leadArgv, leadEnv, think } from "../src/services/lead/brain";

// SPEC-448 (QA) · `brain.ts` adalah titik spawn agen KEDUA di hanoman — satu-satunya di luar
// `services/pty.ts` — dan sampai spec ini ia tak punya satu pun test. Dua kegagalan yang membuat
// lead tak pernah memutuskan sekalipun di instance yang servernya jalan sebagai root hidup persis
// di celah itu:
//
//   (a) execFile memberi anak pipa stdin yang TAK PERNAH ditutup. `claude -p` membaca stdin
//       sebagai sumber prompt alternatif, jadi ia menunggu 3 detik ("Warning: no stdin data
//       received in 3s"), memakan anggaran waktu lead (SPEC-432) dan mengotori stderr — persis
//       stderr yang dipakai `think()` menyusun pesan galatnya, sehingga sebab yang sebenarnya
//       terdorong ke baris kedua.
//   (b) gerbang root claude (`IS_SANDBOX=1`) sudah dibuka SPEC-403 — tapi hanya di `pty.ts`.
//       Kedua commit itu lahir di worktree paralel di hari yang sama dan `e5c73ac` bukan leluhur
//       `a16465e`, jadi titik spawn kedua ini tak pernah mewarisinya. Di VPS (deploy-vps.md
//       menetapkan `User=root`) claude mencetak "--dangerously-skip-permissions cannot be used
//       with root/sudo privileges" lalu `process.exit(1)` — lead exit tanpa keluaran, SETIAP kali.

const FAKE_AGENT = fileURLToPath(new URL("./fixtures/fake-lead-agent.sh", import.meta.url));
chmodSync(FAKE_AGENT, 0o755);

const withBin = (key: "HANOMAN_CLAUDE_BIN" | "HANOMAN_CODEX_BIN") => {
  process.env[key] = FAKE_AGENT;
};
afterEach(() => {
  delete process.env.HANOMAN_CLAUDE_BIN;
  delete process.env.HANOMAN_CODEX_BIN;
});

describe("leadEnv · gerbang root claude (SPEC-403 di titik spawn kedua)", () => {
  it("memasang IS_SANDBOX=1 untuk claude saat uid 0", () => {
    expect(leadEnv("claude", { PATH: "/x" }, 0)).toEqual({ PATH: "/x", IS_SANDBOX: "1" });
  });

  it("tak memasang apa pun untuk claude di uid biasa", () => {
    expect(leadEnv("claude", { PATH: "/x" }, 1000)).toEqual({ PATH: "/x" });
  });

  it("tak memasang apa pun untuk codex — codex tak punya gerbang root", () => {
    expect(leadEnv("codex", { PATH: "/x" }, 0)).toEqual({ PATH: "/x" });
  });

  it("env pemanggil menang: IS_SANDBOX yang sudah ada tak ditimpa jadi berbeda", () => {
    expect(leadEnv("claude", { IS_SANDBOX: "1" }, 0)).toEqual({ IS_SANDBOX: "1" });
  });
});

describe("think · stdin ditutup, env sampai ke proses", () => {
  it("menutup stdin anak sehingga agen one-shot tak menggantung menunggu masukan", async () => {
    withBin("HANOMAN_CLAUDE_BIN");
    // Batas waktu sengaja jauh DI BAWAH 3 detik yang ditunggu claude sungguhan: pipa stdin yang
    // dibiarkan menganga membuat panggilan ini gagal "kehabisan waktu", bukan lambat-tapi-berhasil.
    const out = await think("halo", { agent: "claude", model: "", effort: "", timeoutMs: 1500 });
    expect(out).toContain("stdin: EOF");
  });

  it("meneruskan gerbang root ke proses anak sesuai uid yang berlaku", async () => {
    withBin("HANOMAN_CLAUDE_BIN");
    const out = await think("halo", { agent: "claude", model: "", effort: "", timeoutMs: 1500 });
    expect(out).toContain(`IS_SANDBOX=${process.getuid?.() === 0 ? "1" : ""}`);
  });

  it("sesi codex ikut menutup stdin", async () => {
    withBin("HANOMAN_CODEX_BIN");
    const out = await think("halo", { agent: "codex", model: "", effort: "", timeoutMs: 1500 });
    expect(out).toContain("stdin: EOF");
  });
});

describe("leadArgv · bentuk argv tiap agen (tak berubah oleh SPEC-448)", () => {
  it("claude memakai -p + --dangerously-skip-permissions dan prompt positional terakhir", () => {
    expect(leadArgv({ agent: "claude", model: "claude-opus-5", effort: "xhigh", prompt: "P" }))
      .toEqual(["-p", "--model", "claude-opus-5", "--effort", "xhigh", "--dangerously-skip-permissions", "P"]);
  });

  it("codex memakai exec + bypass approvals, effort lewat -c", () => {
    expect(leadArgv({ agent: "codex", model: "gpt-5.6-sol", effort: "high", prompt: "P" }))
      .toEqual(["exec", "-m", "gpt-5.6-sol", "-c", 'model_reasoning_effort="high"',
        "--dangerously-bypass-approvals-and-sandbox", "P"]);
  });
});
