// SPEC-215 · ADR-0049 · sumber tunggal metadata config runtime (validasi server + render web).
export type ConfigKind = "url" | "int" | "bool" | "string" | "path" | "secret";
export type ApplyMode = "live" | "new-session" | "restart";
export type ConfigCategory = "knob" | "credential" | "bootstrap";

export interface ConfigEntry {
  key: string; group: string; label: string; help?: string;
  kind: ConfigKind; default?: string; apply: ApplyMode; category: ConfigCategory;
  min?: number; max?: number;
  inheritEnv?: boolean; // true = dikonsumsi via warisan proses anak (mirror ke process.env, bukan dibaca cfg.*)
}

export const CONFIG_REGISTRY: ConfigEntry[] = [
  // sync
  { key: "SYNC_SERVER_URL", group: "sync", label: "URL hub", kind: "url", apply: "live", category: "knob",
    help: "Base URL hub tujuan sync (REST + WS). Kosong = instance ini murni HUB." },
  { key: "SYNC_DEVICE_TOKEN", group: "sync", label: "Device token", kind: "secret", apply: "live", category: "credential",
    help: "Token yang diterbitkan hub (tab Perangkat di hub). Dikirim sebagai Bearer." },
  { key: "SYNC_TICK_MS", group: "sync", label: "Interval sync (ms)", kind: "int", apply: "live", category: "knob",
    default: "15000", min: 1000 },
  // claude
  { key: "CLAUDE_CODE_OAUTH_TOKEN", group: "claude", label: "Claude OAuth token", kind: "secret", apply: "new-session", category: "credential", inheritEnv: true,
    help: "Token `claude setup-token`. Diwarisi proses claude yang di-spawn." },
  { key: "ANTHROPIC_API_KEY", group: "claude", label: "Anthropic API key", kind: "secret", apply: "new-session", category: "credential", inheritEnv: true },
  { key: "HANOMAN_CLAUDE_BIN", group: "claude", label: "Biner claude", kind: "path", apply: "new-session", category: "knob", default: "claude" },
  { key: "CLAUDE_CONFIG_DIR", group: "claude", label: "Dir config Claude", kind: "path", apply: "new-session", category: "knob",
    help: "Default ~/.claude. Sumber .credentials.json untuk panel usage/limit." },
  // vps
  { key: "HANOMAN_SSH_KEY_DIR", group: "vps", label: "Dir key SSH", kind: "path", apply: "new-session", category: "knob", help: "Default ~/.hanoman." },
  { key: "HANOMAN_SSH_BIN", group: "vps", label: "Biner ssh", kind: "path", apply: "new-session", category: "knob", default: "ssh" },
  // runtime
  { key: "HANOMAN_EVENTS_TICK_MS", group: "runtime", label: "Interval events (ms)", kind: "int", apply: "live", category: "knob", default: "1000", min: 100 },
  { key: "HANOMAN_UPDATE_FETCH", group: "runtime", label: "Deteksi update saat boot", kind: "bool", apply: "live", category: "knob", default: "1" },
  { key: "HANOMAN_REPO_ROOT", group: "runtime", label: "Root repo hanoman", kind: "path", apply: "restart", category: "knob", help: "Default cwd proses server." },
  { key: "HANOMAN_TMUX_SOCKET", group: "runtime", label: "Socket tmux", kind: "string", apply: "restart", category: "knob", default: "hanoman",
    help: "Mengubah ini TIDAK memindahkan sesi tmux yang sudah hidup — berlaku setelah restart." },
  // gitGraph (SPEC-233 · preferensi tampilan git graph; semua live, dikonsumsi client)
  { key: "gitGraph.style", group: "gitGraph", label: "Gaya graph", kind: "string", apply: "live", category: "knob", default: "rounded", help: "rounded | angular" },
  { key: "gitGraph.colours", group: "gitGraph", label: "Warna lane (CSV)", kind: "string", apply: "live", category: "knob", help: "Daftar warna hex dipisah koma; kosong = palet bawaan." },
  { key: "gitGraph.dateType", group: "gitGraph", label: "Jenis tanggal", kind: "string", apply: "live", category: "knob", default: "author", help: "author | commit" },
  { key: "gitGraph.commitsInitialLoad", group: "gitGraph", label: "Muat awal", kind: "int", apply: "live", category: "knob", default: "200", min: 1 },
  { key: "gitGraph.commitsLoadMore", group: "gitGraph", label: "Muat lagi", kind: "int", apply: "live", category: "knob", default: "100", min: 1 },
  { key: "gitGraph.showRemoteBranches", group: "gitGraph", label: "Tampilkan remote", kind: "bool", apply: "live", category: "knob", default: "1" },
  { key: "gitGraph.showTags", group: "gitGraph", label: "Tampilkan tag", kind: "bool", apply: "live", category: "knob", default: "1" },
  { key: "gitGraph.showStashes", group: "gitGraph", label: "Tampilkan stash", kind: "bool", apply: "live", category: "knob", default: "1" },
  { key: "gitGraph.showUncommitted", group: "gitGraph", label: "Tampilkan uncommitted", kind: "bool", apply: "live", category: "knob", default: "1" },
  { key: "gitGraph.muteMergeCommits", group: "gitGraph", label: "Redupkan merge commit", kind: "bool", apply: "live", category: "knob", default: "1" },
  { key: "gitGraph.fetchAvatars", group: "gitGraph", label: "Ambil avatar (gravatar)", kind: "bool", apply: "live", category: "knob", default: "0", help: "Jaringan eksternal ke gravatar.com." },
  { key: "gitGraph.combineLocalRemote", group: "gitGraph", label: "Gabung label local+remote", kind: "bool", apply: "live", category: "knob", default: "0" },
  { key: "gitGraph.markdown", group: "gitGraph", label: "Render markdown pesan", kind: "bool", apply: "live", category: "knob", default: "1" },
  { key: "gitGraph.emoji", group: "gitGraph", label: "Render emoji shortcode", kind: "bool", apply: "live", category: "knob", default: "1" },
  { key: "gitGraph.issueLinkPattern", group: "gitGraph", label: "Pola link issue", kind: "string", apply: "live", category: "knob", help: "URL dengan $1 untuk nomor issue, mis. https://github.com/acme/app/issues/$1" },
  // bootstrap (read-only)
  { key: "DATABASE_URL", group: "bootstrap", label: "DATABASE_URL", kind: "secret", apply: "restart", category: "bootstrap" },
  { key: "TEST_DATABASE_URL", group: "bootstrap", label: "TEST_DATABASE_URL", kind: "secret", apply: "restart", category: "bootstrap" },
  { key: "PORT", group: "bootstrap", label: "PORT", kind: "int", apply: "restart", category: "bootstrap", default: "8787" },
  { key: "HOST", group: "bootstrap", label: "HOST", kind: "string", apply: "restart", category: "bootstrap", default: "127.0.0.1" },
  { key: "NODE_ENV", group: "bootstrap", label: "NODE_ENV", kind: "string", apply: "restart", category: "bootstrap" },
];

const BY_KEY = new Map(CONFIG_REGISTRY.map((e) => [e.key, e]));
export function configEntry(key: string): ConfigEntry | undefined { return BY_KEY.get(key); }

export function maskSecret(v: string): string {
  return v.length <= 4 ? "••••" : "••••" + v.slice(-4);
}

// Validasi + normalisasi nilai mentah untuk sebuah entri. bool dinormalkan ke "0"/"1".
export function parseConfigValue(
  entry: ConfigEntry, raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim();
  switch (entry.kind) {
    case "int": {
      if (!/^\d+$/.test(v)) return { ok: false, error: "harus bilangan bulat" };
      const n = Number(v);
      if (entry.min !== undefined && n < entry.min) return { ok: false, error: `min ${entry.min}` };
      if (entry.max !== undefined && n > entry.max) return { ok: false, error: `max ${entry.max}` };
      return { ok: true, value: String(n) };
    }
    case "bool": {
      if (["1", "true"].includes(v.toLowerCase())) return { ok: true, value: "1" };
      if (["0", "false"].includes(v.toLowerCase())) return { ok: true, value: "0" };
      return { ok: false, error: "harus 0/1" };
    }
    case "url": {
      try { const u = new URL(v); if (!/^https?:$/.test(u.protocol)) return { ok: false, error: "harus http(s)" }; }
      catch { return { ok: false, error: "URL tak valid" }; }
      return { ok: true, value: v };
    }
    default: // string | path | secret
      if (v.length === 0) return { ok: false, error: "tak boleh kosong" };
      return { ok: true, value: v };
  }
}
