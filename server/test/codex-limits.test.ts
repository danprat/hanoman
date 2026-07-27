import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCodexLimits, _resetCodexLimitsCache } from "../src/services/codex-limits";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-cxlim-")); _resetCodexLimitsCache(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); _resetCodexLimitsCache(); });

// Satu baris rollout persis bentuk yang ditulis codex (event_msg → token_count → rate_limits).
const line = (ts: string, rl: unknown) => JSON.stringify({
  timestamp: ts, type: "event_msg",
  payload: { type: "token_count", info: { total_token_usage: { total_tokens: 1 } }, rate_limits: rl },
}) + "\n";

const RL = (over: Record<string, unknown> = {}) => ({
  limit_id: "codex", limit_name: null,
  primary: { used_percent: 10.0, window_minutes: 300, resets_at: 1783072313 },
  secondary: { used_percent: 62.0, window_minutes: 10080, resets_at: 1783388587 },
  credits: null, individual_limit: null, plan_type: "pro", rate_limit_reached_type: null, ...over,
});

/** Tulis rollout di sessions/<Y>/<M>/<D>/, dengan mtime yang bisa diatur untuk uji "terbaru menang". */
function rollout(name: string, lines: string, mtime?: Date) {
  const d = join(dir, "sessions/2026/07/27");
  mkdirSync(d, { recursive: true });
  const f = join(d, name);
  writeFileSync(f, lines);
  if (mtime) utimesSync(f, mtime, mtime);
  return f;
}
const recent = () => new Date(Date.now() - 60_000).toISOString();

describe("getCodexLimits", () => {
  it("tanpa direktori sessions → unavailable, bukan melempar", async () => {
    const dto = await getCodexLimits(join(dir, "tidak-ada"));
    expect(dto).toEqual({ status: "unavailable", windows: [], fetchedAt: null, plan: null });
  });

  it("rollout tanpa rate_limits → unavailable", async () => {
    rollout("a.jsonl", JSON.stringify({ type: "response_item", payload: {} }) + "\n");
    expect((await getCodexLimits(join(dir, "sessions"))).status).toBe("unavailable");
  });

  it("memetakan primary+secondary jadi window berlabel dari window_minutes", async () => {
    rollout("a.jsonl", line(recent(), RL()));
    const dto = await getCodexLimits(join(dir, "sessions"));
    expect(dto.status).toBe("ok");
    expect(dto.plan).toBe("pro");
    expect(dto.windows).toHaveLength(2);
    const [p, s] = dto.windows;
    expect(p).toMatchObject({ label: "Sesi 5 jam", usedPct: 10, severity: "normal" });
    expect(s).toMatchObject({ label: "Mingguan", usedPct: 62, severity: "normal" });
    // resets_at codex = epoch DETIK → ISO.
    expect(p!.resetsAt).toBe(new Date(1783072313 * 1000).toISOString());
  });

  // Bukti nyata: 27 Jul primary = 10080 (mingguan), 3 Jul primary = 300 (5 jam).
  // Label TIDAK boleh diturunkan dari nama kunci.
  it("primary yang ternyata window mingguan tetap berlabel Mingguan", async () => {
    rollout("a.jsonl", line(recent(), RL({
      primary: { used_percent: 0, window_minutes: 10080, resets_at: 1785727682 }, secondary: null,
    })));
    const dto = await getCodexLimits(join(dir, "sessions"));
    expect(dto.windows).toHaveLength(1);
    expect(dto.windows[0]!.label).toBe("Mingguan");
  });

  it("severity diturunkan dari persen: >=70 warning, >=90 critical", async () => {
    rollout("a.jsonl", line(recent(), RL({
      primary: { used_percent: 72, window_minutes: 300, resets_at: 1783072313 },
      secondary: { used_percent: 95, window_minutes: 10080, resets_at: 1783388587 },
    })));
    const [p, s] = (await getCodexLimits(join(dir, "sessions"))).windows;
    expect(p!.severity).toBe("warning");
    expect(s!.severity).toBe("critical");
  });

  it("mengambil rate_limits TERAKHIR dalam satu berkas", async () => {
    rollout("a.jsonl",
      line("2026-07-27T01:00:00.000Z", RL({ primary: { used_percent: 5, window_minutes: 300, resets_at: 1 } }))
      + line(recent(), RL({ primary: { used_percent: 41, window_minutes: 300, resets_at: 1 } })));
    expect((await getCodexLimits(join(dir, "sessions"))).windows[0]!.usedPct).toBe(41);
  });

  it("berkas rollout TERBARU (mtime) menang atas yang lama", async () => {
    rollout("lama.jsonl", line(recent(), RL({ primary: { used_percent: 9, window_minutes: 300, resets_at: 1 } })),
      new Date(Date.now() - 86_400_000));
    rollout("baru.jsonl", line(recent(), RL({ primary: { used_percent: 33, window_minutes: 300, resets_at: 1 } })),
      new Date());
    expect((await getCodexLimits(join(dir, "sessions"))).windows[0]!.usedPct).toBe(33);
  });

  it("snapshot lawas → stale (data tetap ditampilkan, tapi ditandai)", async () => {
    const old = new Date(Date.now() - 30 * 3_600_000).toISOString();   // 30 jam lalu
    rollout("a.jsonl", line(old, RL()));
    const dto = await getCodexLimits(join(dir, "sessions"));
    expect(dto.status).toBe("stale");
    expect(dto.windows).toHaveLength(2);
    expect(dto.fetchedAt).toBe(old);
  });

  it("rate_limits null (tak ada kuota dilaporkan) diabaikan", async () => {
    rollout("a.jsonl", line(recent(), null));
    expect((await getCodexLimits(join(dir, "sessions"))).status).toBe("unavailable");
  });

  it("baris rusak tak menjatuhkan pembacaan", async () => {
    rollout("a.jsonl", "{bukan json\n" + line(recent(), RL()));
    expect((await getCodexLimits(join(dir, "sessions"))).status).toBe("ok");
  });

  it("rate_limit_reached_type menandai window itu aktif", async () => {
    rollout("a.jsonl", line(recent(), RL({ rate_limit_reached_type: "secondary" })));
    const [p, s] = (await getCodexLimits(join(dir, "sessions"))).windows;
    expect(p!.isActive).toBe(false);
    expect(s!.isActive).toBe(true);
  });
});
