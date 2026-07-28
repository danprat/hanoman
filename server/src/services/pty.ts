import { spawn, type IPty } from "node-pty";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { goalOneLine, agentFlags, codexGoalScript, type Flow, type Agent } from "@hanoman/runner";
import { coerceCodexEffort, type SessionKind } from "@hanoman/shared";
import { readPhases, type Phase } from "./session-phases";
import { effectiveStr } from "../config";

// Sesi hidup di dalam tmux server, bukan di proses API (ADR-0016). Restart `pnpm dev`
// tidak lagi membunuh claude yang sedang bekerja, dan refresh browser hanya menyambung
// ulang klien. Yang dipegang proses ini cuma klien `tmux attach` di atas node-pty.
//
// Socket sendiri (`-L`) memisahkan hanoman dari tmux milik pengguna — `killAll` di test
// tidak boleh menyentuh sesi kerja siapa pun. `-f /dev/null` membuang ~/.tmux.conf yang
// bisa menyalakan status bar atau mengubah prefix, dan merusak TUI claude.
const socket = () => effectiveStr("HANOMAN_TMUX_SOCKET") ?? "hanoman";
const PREFIX = "hanoman-";

// Cukup untuk mengembalikan satu layar penuh plus riwayat, tanpa menahan memori tak
// terbatas untuk sesi yang menyala berhari-hari.
const MAX_SCROLLBACK = 256 * 1024;
const POLL_MS = 500;

// SPEC-196 · marker keputusan (.worktrees/.decisions/<id>) yang terisi = sesi sedang menunggu
// manusia. Satu definisi dipakai listSessions (pembeda terminal) dan scanDecisions (notifikasi).
// statSync gagal (berkas belum ada) → false.
export const markerFilled = (f: string): boolean => {
  try { return statSync(f).size > 0; } catch { return false; }
};

export type Frame =
  | { t: "data"; d: string }
  | { t: "exit"; code: number }
  | { t: "phase"; phases: Phase[] };
// Sengaja bukan `WebSocket`: service ini tidak boleh tahu soal transport, dan test
// menyuntikkan perekam frame biasa.
export type Client = { send(msg: string): void; close(): void };

export type SessionInfo = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
  branch?: string; decision: boolean;
  // SPEC-338 · ADR-0074 · mesin sesi. Sesi lama (tanpa opsi tmux ini) dibaca sebagai "claude".
  agent: Agent;
};
type Pane = SessionInfo & {
  code: number; phaseFile?: string; decisionFile?: string;
  // SPEC-337 · internal saja: kunci audit tak pernah menyeberang ke SessionInfo.
  auditKey?: string; auditProjects?: string;
};

// Satu attachment per sesi: satu klien tmux melayani semua WebSocket yang menonton.
// `lastPhases` menahan JSON fase terakhir yang disiarkan — frame lahir hanya saat berubah.
type Attachment = { pty: IPty; scrollback: string; clients: Set<Client>; lastPhases: string };
const attached = new Map<string, Attachment>();

// Variabel yang sama yang dipakai runner/src/claude-cli.ts.
const claudeBin = () => effectiveStr("HANOMAN_CLAUDE_BIN") ?? "claude";
// SPEC-236 · shell untuk "terminal biasa" non-claude. HANOMAN_SHELL menang (dipakai test),
// lalu $SHELL operator, lalu /bin/bash. Diserahkan ke createSession({command:[shellBin()]}) —
// cabang argv mentah yang sama dipakai Console VPS (ADR-0042).
export const shellBin = (): string => effectiveStr("HANOMAN_SHELL") ?? process.env.SHELL ?? "/bin/bash";
// SPEC-338 · ADR-0074 · cermin HANOMAN_CLAUDE_BIN untuk Codex CLI.
const codexBin = () => effectiveStr("HANOMAN_CODEX_BIN") ?? "codex";
const agentBin = (agent: Agent): string => (agent === "codex" ? codexBin() : claudeBin());

const frame = (f: Frame): string => JSON.stringify(f);
const name = (id: string): string => PREFIX + id;

// SPEC-223 · berkas prompt awal sesi, dibaca `"$(cat …)"` saat sesi lahir (lihat createSession).
// Di tmpdir: ephemeral, always-writable, tak bergantung cwd sesi. id sudah tersanitasi ([a-z0-9_-]).
export const promptFilePath = (id: string): string => `${tmpdir()}/hanoman-prompts/${id}`;

// SPEC-338 · skrip gate mode goal sesi codex. Sekamar dengan berkas prompt: ephemeral, di tmpdir,
// tak bergantung cwd sesi (worktree bisa lenyap saat sesi ditutup). id sudah tersanitasi.
export const goalGatePath = (id: string): string => `${tmpdir()}/hanoman-goal-gates/${id}.sh`;
// Berkas penghitung penolakan gate (pagar anti-loop) — bersebelahan dengan skripnya.
const goalStatePath = (id: string): string => `${tmpdir()}/hanoman-goal-gates/${id}.count`;

function tmux(...args: string[]): string {
  try {
    // stderr di-pipe, bukan diwariskan: `list-panes` pada tmux server yang belum jalan
    // adalah keadaan normal (belum ada sesi), bukan sesuatu yang layak dicetak ke log.
    return execFileSync("tmux", ["-L", socket(), "-f", "/dev/null", ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      throw new Error("tmux tidak ada di PATH — sesi terminal hanoman hidup di dalam tmux (ADR-0016). Pasang: brew install tmux");
    }
    throw new Error(`tmux ${args[0]} gagal: ${(err.stderr ?? err.message).trim()}`);
  }
}

// tmux menyatukan sisa argv-nya jadi satu string lalu menyerahkannya ke shell. Tanpa
// kutip, JSON `--settings` pecah di setiap spasi dan claude mati sebelum lahir.
const sq = (s: string): string => `'${s.split("'").join("'\\''")}'`;

// tmux menolak `.` dan `:` dalam nama sesi. Sesi backlog id-nya bisa ditebak dari spec-nya —
// itulah yang membuat Start dua kali menyambung ke sesi yang sama, bukan melahirkan yang kedua.
// SPEC-294 · satu definisi dipakai terminal route, session-launch, dan governor scheduler —
// tak ada divergensi id sesi antar jalur peluncuran.
export const sessionIdForSpec = (specId: string): string =>
  specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
const idFor = (specId?: string) =>
  specId ? sessionIdForSpec(specId) : randomUUID().slice(0, 8);

const FMT = [
  "#{session_name}", "#{@hanoman_project}", "#{@hanoman_spec}", "#{@hanoman_flow}",
  "#{@hanoman_phase_file}", "#{@hanoman_cwd}", "#{pane_dead}", "#{pane_dead_status}",
  "#{@hanoman_decision_file}", "#{@hanoman_branch}", "#{@hanoman_agent}",
  // SPEC-337 · ADR-0075 · kunci audit lintas project + scope-nya. Hidup di tmux (bukan DB): selamat
  // dari restart API, mati bersama pane. TAK PERNAH ikut ke SessionInfo/API — lihat listSessions.
  "#{@hanoman_audit_key}", "#{@hanoman_audit_projects}",
].join("\t");

// Satu-satunya sumber kebenaran soal sesi adalah tmux server. Tidak ada map yang perlu
// dihidrasi ulang saat API restart: daftar ini selalu apa adanya.
function listPanes(): Pane[] {
  let out: string;
  try { out = tmux("list-panes", "-a", "-F", FMT); }
  catch { return []; } // tmux server belum jalan — belum ada sesi sama sekali
  return out.split("\n").filter(Boolean).flatMap((line) => {
    const [n, projectId, specId, flow, phaseFile, cwd, dead, code, decisionFile, branch, agent,
      auditKey, auditProjects] = line.split("\t");
    if (!n?.startsWith(PREFIX)) return [];
    const exited = dead === "1";
    return [{
      id: n.slice(PREFIX.length), projectId: projectId ?? "", specId: specId || undefined,
      flow: (flow || undefined) as Flow | undefined, phaseFile: phaseFile || undefined,
      cwd: cwd ?? "", exited, code: Number(code) || 0,
      decisionFile: decisionFile || undefined,
      // SPEC-337 · kunci audit + scope-nya (internal; tak pernah keluar lewat listSessions).
      auditKey: auditKey || undefined,
      auditProjects: auditProjects || undefined,
      // SPEC-230 · branch integrasi sesi project-level (PRD: prd/<slug>). Kosong = tak ada.
      branch: branch || undefined,
      // SPEC-196 · sesi hidup dengan marker keputusan terisi = menunggu manusia.
      decision: !exited && !!decisionFile && markerFilled(decisionFile),
      // SPEC-338 · sesi yang lahir sebelum ADR-0074 tak punya opsi ini → claude.
      agent: (agent === "codex" ? "codex" : "claude") as Agent,
    }];
  });
}

export const listSessions = (): SessionInfo[] =>
  listPanes().map(({ id, projectId, specId, flow, cwd, exited, branch, decision, agent }) => ({
    id, projectId, specId, flow, cwd, exited, branch, decision, agent,
  }));

// SPEC-184 · sesi hidup yang punya marker keputusan — masukan scanDecisions().
export const liveDecisions = (): { id: string; specId?: string; projectId: string; decisionFile: string }[] =>
  listPanes()
    .filter((p) => !p.exited && p.decisionFile)
    .map((p) => ({ id: p.id, specId: p.specId, projectId: p.projectId, decisionFile: p.decisionFile! }));

export const getSession = (id: string): Pane | undefined => listPanes().find((p) => p.id === id);

// SPEC-362 · ADR-0079 · riwayat sesi. pty.ts sengaja TETAP nol dependensi DB: ia hanya menembakkan
// dua peristiwa, dan services/session-history.ts yang mendaftarkan diri lewat server.ts (pola
// registerSchedulerSource, SPEC-294). createSession & killSession adalah SATU-SATUNYA pintu lahir
// & mati sesi — seluruh pemanggil (routes/terminal, session-launch, specs, ide, vps) lewat sini,
// jadi dua titik ini menangkap semuanya tanpa menyentuh 12 call site.
export type SessionBirth = {
  sessionId: string; projectId: string; specId?: string; flow?: string; kind: SessionKind;
  agent: Agent; model?: string; effort?: string; branch?: string; cwd: string;
};
export type SessionDeath = { sessionId: string; exitCode: number | null; transcript: string | null };
type SessionHooks = { onBirth?: (b: SessionBirth) => void; onDeath?: (d: SessionDeath) => void };
let hooks: SessionHooks = {};
export function registerSessionHooks(h: SessionHooks): void { hooks = h; }
// Fire-and-forget: riwayat tak boleh memblokir atau menggagalkan kelahiran/penutupan sesi.
const emitBirth = (b: SessionBirth): void => { try { hooks.onBirth?.(b); } catch { /* riwayat opsional */ } };
const emitDeath = (d: SessionDeath): void => { try { hooks.onDeath?.(d); } catch { /* riwayat opsional */ } };

// Jenis sesi diturunkan saat LAHIR, saat opsinya masih di tangan — sesudah itu tmux hanya menyimpan
// sebagian (tak ada jejak `command` maupun `prompt`). Fungsi murni supaya bisa diuji tanpa tmux.
export function sessionKind(
  o: { id: string; specId?: string; flow?: string; command?: string[] }, projectId: string, cwd: string,
): SessionKind {
  if (o.specId) return "spec";
  if (o.flow === "reverse" || o.flow === "prd" || o.flow === "scaffold" || o.flow === "breakdown") return o.flow;
  if (o.id.startsWith("xaudit-")) return "cross-audit";
  if (projectId.startsWith("vps")) return "vps";           // routes/vps.ts: "vps:<id>" & "vps-console:<id>"
  if (o.command) return "shell";
  if (cwd.includes("/.worktrees/")) return "worktree";     // sesi konflik merge/integrate
  return "terminal";
}

// Scrollback lenyap bersama pane: ini WAJIB dipanggil sebelum `tmux kill-session`. Tanpa `-e`
// (kebalikan attach() untuk pane mati) — arsip disimpan sebagai teks polos: bisa dicari, aman
// dirender di <pre>, tak menyuntikkan ANSI ke DOM.
function captureTranscript(id: string): string | null {
  try {
    const out = tmux("capture-pane", "-p", "-J", "-S", "-50000", "-t", name(id));
    return out.trim() ? out : null;
  } catch { return null; }
}

// SPEC-337 · ADR-0075 · scope sesi cross-audit pemilik kunci. Hanya pane HIDUP yang dihitung —
// sesi mati = kunci mati, tanpa revoke. Scope kosong diperlakukan tak sah (sesi selalu punya
// minimal project-nya sendiri), jadi pemanggil tak pernah menerima daftar kosong yang menipu.
export function auditSessionScope(key: string): string[] | null {
  if (!key) return null;
  const p = listPanes().find((x) => x.auditKey === key && !x.exited);
  if (!p) return null;
  const scope = (p.auditProjects ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return scope.length ? scope : null;
}

export type CreateOpts = {
  id?: string; specId?: string; flow?: Flow; branch?: string; prompt?: string; phaseFile?: string;
  decisionFile?: string; model?: string; effort?: string; command?: string[];
  // SPEC-332 · ADR-0073 · kondisi mode goal; kosong = mode goal mati untuk sesi ini.
  goal?: string;
  // SPEC-338 · ADR-0074 · mesin sesi; kosong = claude (default historis).
  agent?: Agent;
  // SPEC-337 · ADR-0075 · env tambahan di depan argv sesi (mis. kunci + URL audit lintas).
  env?: Record<string, string>;
  // SPEC-337 · ADR-0075 · kunci audit + daftar project ter-scope, dipasang sebagai tmux option.
  audit?: { key: string; projects: string[] };
};

export function createSession(projectId: string, cwd: string, opts: CreateOpts = {}): SessionInfo {
  // Sesi project-level (reverse) tak punya spec: id-nya dipasok route agar tetap
  // deterministik — Start kedua harus menyambung, bukan melahirkan sesi baru (SPEC-166).
  const id = opts.id ?? idFor(opts.specId);
  // Sesi sebuah backlog item itu tunggal: menekan Start lagi harus menyambung ke `claude`
  // yang sudah jalan, bukan menyalakan yang kedua di atas worktree yang sama (ADR-0015).
  const existing = getSession(id);
  if (existing) return existing;

  // `--dangerously-skip-permissions` melewati prompt izin, bukan sistem hook. Sejak ADR-0037
  // tak ada lagi hook deny — `--settings` di sini hanya memasang marker keputusan (SPEC-184),
  // digabung dengan settings pengguna. Agen dipercaya penuh; isolasi murni lewat worktree.
  // Console VPS (SPEC-211) memasok argv sendiri (mis. `ssh -t …`): shell mentah, bukan
  // claude — `--dangerously-skip-permissions`/`--settings` hanya relevan untuk claude.
  // SPEC-223 · prompt bisa BESAR: scaffold/reverse memuat STANDAR DOCS (~7KB) dan ide/objective
  // bisa panjang. tmux membatasi panjang SATU command (~16KB) — prompt inline menembusnya dan
  // `new-session` mati dengan `command too long` (dilaporkan sebagai `tmux set-option gagal` karena
  // set-option adalah args[0] invokasi gabungan). Tulis prompt ke file lalu serahkan lewat
  // `"$(cat <file>)"`: sh -c yang menjalankan sesi meng-expand-nya saat lahir, jadi claude
  // menerima prompt penuh via ARG_MAX (jauh > 16KB) sementara command tmux tetap pendek. Isi file
  // TIDAK dipindai ulang oleh shell (hasil command-substitution dikutip ganda) → aman dari injeksi.
  // Ditulis ke tmpdir (bukan turunan cwd): cwd bisa homedir (sesi VPS) yang tak boleh dikotori dan
  // parent-nya tak selalu writable. Dibaca sekali saat lahir; OS yang membersihkan tmpdir.
  let promptArg = "";
  if (!opts.command && opts.prompt) {
    const promptFile = promptFilePath(id);
    mkdirSync(dirname(promptFile), { recursive: true });
    writeFileSync(promptFile, opts.prompt);
    promptArg = `"$(cat ${sq(promptFile)})"`;
  }
  // SPEC-338 · ADR-0074 · perbedaan CLI antar agen dirakit `agentFlags`; di sini tinggal
  // mengutip & merangkai, persis seperti sebelumnya untuk claude.
  const agent: Agent = opts.agent ?? "claude";
  let argv: string;
  if (opts.command) {
    argv = opts.command.map(sq).join(" ");
  } else {
    // SPEC-338 · mode goal codex = gate deterministik (hook codex hanya dukung type="command").
    // Skripnya ditulis sekarang supaya sudah ada saat hook pertama menembak.
    let goalGate: string | undefined;
    if (agent === "codex" && opts.goal && opts.flow && opts.specId) {
      goalGate = goalGatePath(id);
      mkdirSync(dirname(goalGate), { recursive: true });
      writeFileSync(goalGate, codexGoalScript({
        flow: opts.flow, specId: opts.specId, condition: opts.goal,
        phaseFile: opts.phaseFile ?? "", worktree: cwd, stateFile: goalStatePath(id),
      }), { mode: 0o755 });
    }
    // SPEC-339 · titik cekik tunggal: effort yang tak didukung model codex diturunkan ke fallback
    // model SEBELUM argv dirakit. Ditaruh di sini, bukan di route, karena SEMUA kelahiran sesi
    // bermuara ke createSession — termasuk jalur ber-AgentToken yang tak lewat picker UI.
    // Hanya dikoersi bila keduanya ada: tanpa effort, `agentFlags` memang tak memasang flag apa pun.
    const effort = agent === "codex" && opts.model && opts.effort
      ? coerceCodexEffort(opts.model, opts.effort)
      : opts.effort;
    // Prompt (bila ada) = argumen positional pertama agen, TANPA sq (sudah dikutip ganda).
    const flags = agentFlags({
      agent, model: opts.model, effort,
      decisionFile: opts.decisionFile, goal: opts.goal, goalGate,
    }).map(sq).join(" ");
    argv = [sq(agentBin(agent)), promptArg, flags].filter(Boolean).join(" ");
  }

  // Env di depan perintah, bukan `new-session -e`: tmux menyerahkan sisa argv-nya ke shell,
  // jadi penugasan env bekerja di semua versi tmux sementara `-e` baru ada sejak 3.0.
  // Direktorinya dibuat di sini — `echo >> berkas` milik agen tak membuat direktori induk.
  const envPairs: string[] = [];
  if (opts.phaseFile) {
    mkdirSync(dirname(opts.phaseFile), { recursive: true });
    envPairs.push(`HANOMAN_PHASE_FILE=${sq(opts.phaseFile)}`);
  }
  // SPEC-337 · env sesi cross-audit (HANOMAN_AUDIT_KEY/URL) lewat jalur yang sama.
  for (const [k, v] of Object.entries(opts.env ?? {})) envPairs.push(`${k}=${sq(v)}`);
  const cmd = envPairs.length ? `${envPairs.join(" ")} ${argv}` : argv;
  // SPEC-184 · direktori marker keputusan; hook Notification menulis absolute path di dalamnya.
  if (opts.decisionFile) mkdirSync(dirname(opts.decisionFile), { recursive: true });

  // Opsi global mendahului `new-session` dalam satu invokasi: window lahir sudah membawa
  // `remain-on-exit`, jadi proses yang mati seketika pun meninggalkan pane mati yang masih
  // bisa dibaca. Menyetelnya setelah new-session akan balapan dengan proses yang cepat mati.
  tmux(
    "set-option", "-g", "remain-on-exit", "on", ";",
    "set-option", "-g", "status", "off", ";",
    // Prefix mati: tmux di sini adalah detail implementasi, dan C-b harus sampai ke claude.
    "set-option", "-g", "prefix", "None", ";",
    // SPEC-209 · riwayat claude hidup di scrollback pane tmux; klien hanya menerima layar
    // yang terlihat (ADR-0016). `mouse on` membuat tmux mengaktifkan mouse-reporting di terminal
    // klien, jadi wheel di xterm.js diteruskan → tmux → copy-mode → scroll riwayat ke atas/bawah.
    // history-limit dinaikkan dari default 2000 agar run panjang tak terpotong (capture pane mati
    // sudah baca -2000). ponytail: 50000 baris/pane; turunkan bila memori sesi berhari-hari mepet.
    "set-option", "-g", "mouse", "on", ";",
    "set-option", "-g", "history-limit", "50000", ";",
    "set-option", "-g", "default-terminal", "screen-256color", ";",
    "new-session", "-d", "-s", name(id), "-c", cwd, cmd, ";",
    "set-option", "-t", name(id), "@hanoman_project", projectId, ";",
    "set-option", "-t", name(id), "@hanoman_cwd", cwd,
  );
  if (opts.specId) tmux("set-option", "-t", name(id), "@hanoman_spec", opts.specId);
  if (opts.flow) tmux("set-option", "-t", name(id), "@hanoman_flow", opts.flow);
  // SPEC-230 · branch integrasi sesi (mis. PRD prd/<slug>) → dipakai review/integrate ber-skop sesi.
  if (opts.branch) tmux("set-option", "-t", name(id), "@hanoman_branch", opts.branch);
  // SPEC-338 · mesin sesi ikut tersimpan di tmux — sumber kebenaran sesi tetap tmux, bukan DB.
  tmux("set-option", "-t", name(id), "@hanoman_agent", agent);
  if (opts.phaseFile) tmux("set-option", "-t", name(id), "@hanoman_phase_file", opts.phaseFile);
  if (opts.decisionFile) tmux("set-option", "-t", name(id), "@hanoman_decision_file", opts.decisionFile);
  // SPEC-337 · ADR-0075 · kunci audit + scope-nya. Dibaca auditSessionScope saat request masuk.
  if (opts.audit) {
    tmux("set-option", "-t", name(id), "@hanoman_audit_key", opts.audit.key);
    tmux("set-option", "-t", name(id), "@hanoman_audit_projects", opts.audit.projects.join(","));
  }
  // SPEC-332 · fire-and-forget: respons HTTP tak boleh menunggu TUI siap. Gagal = diam, karena
  // jaminan mode goal sudah dipegang hook Stop di argv di atas.
  // SPEC-338 · khusus claude: `/goal` adalah perintah Claude Code; codex tak punya padanan
  // terverifikasi — jaminannya di sana adalah gate hook deterministik.
  if (opts.goal && !opts.command && agent === "claude") void armGoalInTui(id, opts.goal).catch(() => { /* best-effort */ });
  // SPEC-362 · sesi benar-benar BARU (cabang `existing` di atas sudah return lebih dulu — re-attach
  // ADR-0015 bukan sesi baru dan tak boleh melahirkan baris riwayat kedua).
  emitBirth({
    sessionId: id, projectId, specId: opts.specId, flow: opts.flow,
    kind: sessionKind({ id, specId: opts.specId, flow: opts.flow, command: opts.command }, projectId, cwd),
    agent, model: opts.model, effort: opts.effort, branch: opts.branch, cwd,
  });
  return { id, projectId, specId: opts.specId, flow: opts.flow, cwd, branch: opts.branch, exited: false, decision: false, agent };
}

// SPEC-332 · ADR-0073 — jalur KEDUA mode goal. Hook Stop di `--settings` adalah jaminannya; ini
// murni untuk VISIBILITAS: mengetik `/goal <kondisi>` membuat Claude Code men-set `activeGoal`
// miliknya, jadi `/goal` menampilkan status dan goal ikut dipulihkan saat sesi di-resume.
// Keduanya tak saling menghapus: sumber yang dibaca `/goal` saat mencari goal lama hanya
// session hooks registry, sementara hook kita hidup di settings. Konsekuensi yang diterima sadar —
// saat keduanya terpasang, satu percobaan stop dievaluasi dua kali.
// SEKALI kirim (bukan kirim-ulang tiap percobaan): mengetik dua kali akan melahirkan dua pesan.
export type GoalArmOpts = { pollMs?: number; readyTries?: number; settleMs?: number; verifyTries?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const paneText = (id: string): string => {
  try { return tmux("capture-pane", "-p", "-t", name(id)); } catch { return ""; }
};

export async function armGoalInTui(id: string, condition: string, o: GoalArmOpts = {}): Promise<boolean> {
  const pollMs = o.pollMs ?? 500, readyTries = o.readyTries ?? 20;
  const settleMs = o.settleMs ?? 1200, verifyTries = o.verifyTries ?? 12;
  const line = goalOneLine(condition);
  if (!line) return false;
  // Tunggu pane menggambar sesuatu (TUI sudah hidup). Habis percobaan → kirim saja: yang hilang
  // hanyalah visibilitas, sementara jaminan sudah dipegang hook settings.
  for (let i = 0; i < readyTries; i++) {
    const p = getSession(id);
    if (!p || p.exited) return false;
    if (paneText(id).trim()) break;
    await sleep(pollMs);
  }
  await sleep(settleMs);
  const p = getSession(id);
  if (!p || p.exited) return false;
  try {
    // `-l` = literal: tmux tak menafsirkan isi kondisi sebagai nama tombol.
    tmux("send-keys", "-t", name(id), "-l", `/goal ${line}`);
    tmux("send-keys", "-t", name(id), "Enter");
  } catch { return false; }   // sesi lenyap di tengah jalan
  for (let i = 0; i < verifyTries; i++) {
    if (paneText(id).includes("/goal")) return true;
    await sleep(pollMs);
  }
  return false;
}

// Fase dibaca dari berkasnya, tidak disimpan: sesi yang selamat dari restart API tetap
// melaporkan fase yang benar tanpa map yang perlu dihidrasi ulang.
export function sessionPhases(id: string): Phase[] | null {
  const p = getSession(id);
  if (!p?.flow || !p.phaseFile) return null;
  return readPhases(p.phaseFile, p.flow);
}

// Fase per spec untuk semua sesi tmux, dalam satu `list-panes` — dipakai GET /specs untuk
// menurunkan stage live tanpa satu tmux call per spec (SPEC-168). Tak difilter `exited`:
// berkas fase pane mati (belum di-DELETE) tetap kebenaran terakhirnya; forward-only di
// pemanggil (stageFor + guard STAGES.indexOf) menjaga tak ada stage yang mundur.
export function sessionPhasesBySpec(): Map<string, { phases: Phase[]; cwd: string }> {
  const out = new Map<string, { phases: Phase[]; cwd: string }>();
  for (const p of listPanes()) {
    if (!p.specId || !p.flow || !p.phaseFile) continue;
    // cwd = worktree run-nya: GET /specs menggerbang `done` dengan plan di dalamnya (SPEC-173).
    out.set(p.specId, { phases: readPhases(p.phaseFile, p.flow), cwd: p.cwd });
  }
  return out;
}

function broadcast(a: Attachment, f: Frame): void {
  const msg = frame(f);
  for (const c of a.clients) c.send(msg);
}

// Klien tmux mati bukan berarti sesi berakhir: kita bisa di-detach paksa, atau server API
// ditutup. Yang menentukan akhir adalah pane-nya — itulah yang di-poll di bawah.
function open(id: string): Attachment {
  const pty = spawnPty("attach-session", "-d", "-t", name(id));
  const a: Attachment = { pty, scrollback: "", clients: new Set(), lastPhases: "" };
  pty.onData((d) => {
    a.scrollback = (a.scrollback + d).slice(-MAX_SCROLLBACK);
    broadcast(a, { t: "data", d });
  });
  pty.onExit(() => { if (attached.get(id) === a) drop(id); });
  attached.set(id, a);
  startPoll();
  return a;
}

// Lepas klien tmux; sesi tmux-nya jalan terus.
function drop(id: string): void {
  const a = attached.get(id);
  if (!a) return;
  attached.delete(id);
  a.pty.kill();
  for (const c of a.clients) c.close();
  a.clients.clear();
}

// Pane-nya benar-benar mati: kabari penonton sebelum melepas klien.
function end(id: string, code: number): void {
  const a = attached.get(id);
  if (!a) return;
  broadcast(a, { t: "exit", code });
  drop(id);
}

// Fase yang dilaporkan agen (SPEC-162). Frame hanya lahir saat isinya berubah — kalau tidak,
// tiap tick poll akan membanjiri klien dengan daftar fase yang sama persis.
// Terima Pane yang sudah dipegang loop poll (punya flow+phaseFile): baca berkas fase langsung
// tanpa sessionPhases→getSession→listPanes lagi. SPEC-197: menghindari 1+K spawn `tmux list-panes`
// sinkron per tick 500ms saat K terminal terbuka.
function pollPhases(p: Pane, a: Attachment): void {
  if (!p.flow || !p.phaseFile) return;
  const phases = readPhases(p.phaseFile, p.flow);
  const json = JSON.stringify(phases);
  if (json === a.lastPhases) return;
  a.lastPhases = json;
  broadcast(a, { t: "phase", phases });
}

let poll: NodeJS.Timeout | undefined;
// ponytail: satu `tmux list-panes` + satu bacaan berkas fase per 500ms untuk semua sesi
// terbuka. Ganti dengan hook `pane-died` + `wait-for` kalau terminal yang terbuka bersamaan
// pernah sampai puluhan.
function startPoll(): void {
  if (poll) return;
  poll = setInterval(() => {
    const live = new Map(listPanes().map((p) => [p.id, p]));
    for (const id of [...attached.keys()]) {
      const p = live.get(id);
      if (!p) end(id, 0);            // sesinya dibunuh dari luar
      else if (p.exited) end(id, p.code);
      else pollPhases(p, attached.get(id)!);
    }
    if (attached.size === 0 && poll) { clearInterval(poll); poll = undefined; }
  }, POLL_MS);
  poll.unref();
}

export function attach(id: string, c: Client): void {
  const p = getSession(id);
  if (!p) { c.close(); return; }
  // Pane mati tidak butuh klien tmux — attach ke sana tidak menggambar ulang apa pun.
  // Putar ulang layarnya lalu tutup, persis seperti membuka kembali tab sesi yang berakhir.
  if (p.exited) {
    const screen = tmux("capture-pane", "-p", "-e", "-J", "-S", "-2000", "-t", name(id));
    if (screen.trim()) c.send(frame({ t: "data", d: screen.replace(/\n/g, "\r\n") }));
    c.send(frame({ t: "exit", code: p.code }));
    c.close();
    return;
  }
  const a = attached.get(id) ?? open(id);
  a.clients.add(c);
  // Scrollback lebih dulu untuk klien kedua; klien pertama digambar ulang oleh tmux sendiri.
  if (a.scrollback) c.send(frame({ t: "data", d: a.scrollback }));
  // Fase dikirim ke klien ini saja: `lastPhases` milik attachment sudah terisi kalau klien
  // pertama menerimanya, dan siaran ulang tak akan pernah sampai ke klien kedua.
  const phases = sessionPhases(id);
  if (phases) {
    a.lastPhases = JSON.stringify(phases);
    c.send(frame({ t: "phase", phases }));
  }
}

export const detach = (id: string, c: Client): void => { attached.get(id)?.clients.delete(c); };

export function writeTo(id: string, d: string): void { attached.get(id)?.pty.write(d); }

export function resize(id: string, cols: number, rows: number): void {
  attached.get(id)?.pty.resize(cols, rows);
}

export function killSession(id: string): boolean {
  const p = getSession(id);
  if (!p) return false;
  // SPEC-362 · capture SEBELUM kill: sesudah `kill-session` scrollback-nya tak ada lagi.
  const transcript = captureTranscript(id);
  drop(id);
  tmux("kill-session", "-t", name(id));
  emitDeath({ sessionId: id, exitCode: p.exited ? p.code : null, transcript });
  return true;
}

// Untuk test: buang tmux server hanoman seluruhnya.
export function killAll(): void {
  for (const id of [...attached.keys()]) drop(id);
  try { tmux("kill-server"); } catch { /* belum jalan */ }
}

// Untuk shutdown API: lepaskan klien tmux, biarkan sesinya jalan terus.
export function detachAll(): void {
  for (const id of [...attached.keys()]) drop(id);
}

// node-pty mem-publish prebuilds/*/spawn-helper dengan mode 0644. Tanpa exec bit setiap
// fork mati dengan "posix_spawnp failed", pesan yang tidak menyebut node-pty sama sekali.
// `postinstall` di package.json memperbaikinya, tapi pnpm melewati script itu saat tree
// sudah up-to-date — jadi terjemahkan errornya alih-alih membiarkan orang menebak.
function spawnPty(...args: string[]): IPty {
  try {
    return spawn("tmux", ["-L", socket(), "-f", "/dev/null", ...args], {
      name: "xterm-256color", cols: 80, rows: 24,
      env: process.env as Record<string, string>,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.includes("posix_spawnp")) throw e;
    throw new Error(
      `${msg} — spawn-helper node-pty kemungkinan kehilangan exec bit. ` +
      `Jalankan: pnpm --filter ./server run postinstall`,
    );
  }
}
