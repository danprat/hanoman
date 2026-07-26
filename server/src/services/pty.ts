import { spawn, type IPty } from "node-pty";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { guardSettings, goalOneLine, type Flow } from "@hanoman/runner";
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
};
type Pane = SessionInfo & { code: number; phaseFile?: string; decisionFile?: string };

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

const frame = (f: Frame): string => JSON.stringify(f);
const name = (id: string): string => PREFIX + id;

// SPEC-223 · berkas prompt awal sesi, dibaca `"$(cat …)"` saat sesi lahir (lihat createSession).
// Di tmpdir: ephemeral, always-writable, tak bergantung cwd sesi. id sudah tersanitasi ([a-z0-9_-]).
export const promptFilePath = (id: string): string => `${tmpdir()}/hanoman-prompts/${id}`;

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
  "#{@hanoman_decision_file}", "#{@hanoman_branch}",
].join("\t");

// Satu-satunya sumber kebenaran soal sesi adalah tmux server. Tidak ada map yang perlu
// dihidrasi ulang saat API restart: daftar ini selalu apa adanya.
function listPanes(): Pane[] {
  let out: string;
  try { out = tmux("list-panes", "-a", "-F", FMT); }
  catch { return []; } // tmux server belum jalan — belum ada sesi sama sekali
  return out.split("\n").filter(Boolean).flatMap((line) => {
    const [n, projectId, specId, flow, phaseFile, cwd, dead, code, decisionFile, branch] = line.split("\t");
    if (!n?.startsWith(PREFIX)) return [];
    const exited = dead === "1";
    return [{
      id: n.slice(PREFIX.length), projectId: projectId ?? "", specId: specId || undefined,
      flow: (flow || undefined) as Flow | undefined, phaseFile: phaseFile || undefined,
      cwd: cwd ?? "", exited, code: Number(code) || 0,
      decisionFile: decisionFile || undefined,
      // SPEC-230 · branch integrasi sesi project-level (PRD: prd/<slug>). Kosong = tak ada.
      branch: branch || undefined,
      // SPEC-196 · sesi hidup dengan marker keputusan terisi = menunggu manusia.
      decision: !exited && !!decisionFile && markerFilled(decisionFile),
    }];
  });
}

export const listSessions = (): SessionInfo[] =>
  listPanes().map(({ id, projectId, specId, flow, cwd, exited, branch, decision }) => ({
    id, projectId, specId, flow, cwd, exited, branch, decision,
  }));

// SPEC-184 · sesi hidup yang punya marker keputusan — masukan scanDecisions().
export const liveDecisions = (): { id: string; specId?: string; projectId: string; decisionFile: string }[] =>
  listPanes()
    .filter((p) => !p.exited && p.decisionFile)
    .map((p) => ({ id: p.id, specId: p.specId, projectId: p.projectId, decisionFile: p.decisionFile! }));

export const getSession = (id: string): Pane | undefined => listPanes().find((p) => p.id === id);

export type CreateOpts = {
  id?: string; specId?: string; flow?: Flow; branch?: string; prompt?: string; phaseFile?: string;
  decisionFile?: string; model?: string; effort?: string; command?: string[];
  // SPEC-332 · ADR-0073 · kondisi mode goal; kosong = mode goal mati untuk sesi ini.
  goal?: string;
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
  let argv: string;
  if (opts.command) {
    argv = opts.command.map(sq).join(" ");
  } else {
    // Prompt (bila ada) = argumen positional pertama claude, TANPA sq (sudah dikutip ganda).
    const flags = [
      ...(opts.model ? ["--model", opts.model] : []),
      ...(opts.effort ? ["--effort", opts.effort] : []),
      "--dangerously-skip-permissions",
      "--settings", JSON.stringify(guardSettings(opts.decisionFile, opts.goal)),
    ].map(sq).join(" ");
    argv = [sq(claudeBin()), promptArg, flags].filter(Boolean).join(" ");
  }

  // Env di depan perintah, bukan `new-session -e`: tmux menyerahkan sisa argv-nya ke shell,
  // jadi penugasan env bekerja di semua versi tmux sementara `-e` baru ada sejak 3.0.
  // Direktorinya dibuat di sini — `echo >> berkas` milik agen tak membuat direktori induk.
  let cmd = argv;
  if (opts.phaseFile) {
    mkdirSync(dirname(opts.phaseFile), { recursive: true });
    cmd = `HANOMAN_PHASE_FILE=${sq(opts.phaseFile)} ${argv}`;
  }
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
  if (opts.phaseFile) tmux("set-option", "-t", name(id), "@hanoman_phase_file", opts.phaseFile);
  if (opts.decisionFile) tmux("set-option", "-t", name(id), "@hanoman_decision_file", opts.decisionFile);
  // SPEC-332 · fire-and-forget: respons HTTP tak boleh menunggu TUI siap. Gagal = diam, karena
  // jaminan mode goal sudah dipegang hook Stop di `--settings` di atas.
  if (opts.goal && !opts.command) void armGoalInTui(id, opts.goal).catch(() => { /* best-effort */ });
  return { id, projectId, specId: opts.specId, flow: opts.flow, cwd, branch: opts.branch, exited: false, decision: false };
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
  if (!getSession(id)) return false;
  drop(id);
  tmux("kill-session", "-t", name(id));
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
