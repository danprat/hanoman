import { spawn, type IPty } from "node-pty";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { guardSettings, type Flow } from "@hanoman/runner";
import { guardCommand } from "../runner/deps";
import { readPhases, type Phase } from "./session-phases";

// Sesi hidup di dalam tmux server, bukan di proses API (ADR-0016). Restart `pnpm dev`
// tidak lagi membunuh claude yang sedang bekerja, dan refresh browser hanya menyambung
// ulang klien. Yang dipegang proses ini cuma klien `tmux attach` di atas node-pty.
//
// Socket sendiri (`-L`) memisahkan hanoman dari tmux milik pengguna — `killAll` di test
// tidak boleh menyentuh sesi kerja siapa pun. `-f /dev/null` membuang ~/.tmux.conf yang
// bisa menyalakan status bar atau mengubah prefix, dan merusak TUI claude.
const socket = () => process.env.HANOMAN_TMUX_SOCKET ?? "hanoman";
const PREFIX = "hanoman-";

// Cukup untuk mengembalikan satu layar penuh plus riwayat, tanpa menahan memori tak
// terbatas untuk sesi yang menyala berhari-hari.
const MAX_SCROLLBACK = 256 * 1024;
const POLL_MS = 500;

export type Frame =
  | { t: "data"; d: string }
  | { t: "exit"; code: number }
  | { t: "phase"; phases: Phase[] };
// Sengaja bukan `WebSocket`: service ini tidak boleh tahu soal transport, dan test
// menyuntikkan perekam frame biasa.
export type Client = { send(msg: string): void; close(): void };

export type SessionInfo = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
};
type Pane = SessionInfo & { code: number; phaseFile?: string };

// Satu attachment per sesi: satu klien tmux melayani semua WebSocket yang menonton.
// `lastPhases` menahan JSON fase terakhir yang disiarkan — frame lahir hanya saat berubah.
type Attachment = { pty: IPty; scrollback: string; clients: Set<Client>; lastPhases: string };
const attached = new Map<string, Attachment>();

// Variabel yang sama yang dipakai runner/src/claude-cli.ts.
const claudeBin = () => process.env.HANOMAN_CLAUDE_BIN ?? "claude";

const frame = (f: Frame): string => JSON.stringify(f);
const name = (id: string): string => PREFIX + id;

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
const idFor = (specId?: string) =>
  specId ? specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_") : randomUUID().slice(0, 8);

const FMT = [
  "#{session_name}", "#{@hanoman_project}", "#{@hanoman_spec}", "#{@hanoman_flow}",
  "#{@hanoman_phase_file}", "#{@hanoman_cwd}", "#{pane_dead}", "#{pane_dead_status}",
].join("\t");

// Satu-satunya sumber kebenaran soal sesi adalah tmux server. Tidak ada map yang perlu
// dihidrasi ulang saat API restart: daftar ini selalu apa adanya.
function listPanes(): Pane[] {
  let out: string;
  try { out = tmux("list-panes", "-a", "-F", FMT); }
  catch { return []; } // tmux server belum jalan — belum ada sesi sama sekali
  return out.split("\n").filter(Boolean).flatMap((line) => {
    const [n, projectId, specId, flow, phaseFile, cwd, dead, code] = line.split("\t");
    if (!n?.startsWith(PREFIX)) return [];
    return [{
      id: n.slice(PREFIX.length), projectId: projectId ?? "", specId: specId || undefined,
      flow: (flow || undefined) as Flow | undefined, phaseFile: phaseFile || undefined,
      cwd: cwd ?? "", exited: dead === "1", code: Number(code) || 0,
    }];
  });
}

export const listSessions = (): SessionInfo[] =>
  listPanes().map(({ id, projectId, specId, flow, cwd, exited }) => ({ id, projectId, specId, flow, cwd, exited }));

export const getSession = (id: string): Pane | undefined => listPanes().find((p) => p.id === id);

export type CreateOpts = {
  id?: string; specId?: string; flow?: Flow; prompt?: string; phaseFile?: string;
  model?: string; effort?: string;
};

export function createSession(projectId: string, cwd: string, opts: CreateOpts = {}): SessionInfo {
  // Sesi project-level (reverse) tak punya spec: id-nya dipasok route agar tetap
  // deterministik — Start kedua harus menyambung, bukan melahirkan sesi baru (SPEC-166).
  const id = opts.id ?? idFor(opts.specId);
  // Sesi sebuah backlog item itu tunggal: menekan Start lagi harus menyambung ke `claude`
  // yang sudah jalan, bukan menyalakan yang kedua di atas worktree yang sama (ADR-0015).
  const existing = getSession(id);
  if (existing) return existing;

  // `--dangerously-skip-permissions` melewati prompt izin, bukan sistem hook. Tanpa
  // `--settings` di bawah, sesi ini tidak punya gerbang sama sekali — dan di bawah flag itu
  // PreToolUse adalah satu-satunya yang tersisa (ADR-0010).
  const argv = [
    claudeBin(),
    ...(opts.prompt ? [opts.prompt] : []),
    ...(opts.model ? ["--model", opts.model] : []),
    ...(opts.effort ? ["--effort", opts.effort] : []),
    "--dangerously-skip-permissions",
    "--settings", JSON.stringify(guardSettings(guardCommand())),
  ].map(sq).join(" ");

  // Env di depan perintah, bukan `new-session -e`: tmux menyerahkan sisa argv-nya ke shell,
  // jadi penugasan env bekerja di semua versi tmux sementara `-e` baru ada sejak 3.0.
  // Direktorinya dibuat di sini — `echo >> berkas` milik agen tak membuat direktori induk.
  let cmd = argv;
  if (opts.phaseFile) {
    mkdirSync(dirname(opts.phaseFile), { recursive: true });
    cmd = `HANOMAN_PHASE_FILE=${sq(opts.phaseFile)} ${argv}`;
  }

  // Opsi global mendahului `new-session` dalam satu invokasi: window lahir sudah membawa
  // `remain-on-exit`, jadi proses yang mati seketika pun meninggalkan pane mati yang masih
  // bisa dibaca. Menyetelnya setelah new-session akan balapan dengan proses yang cepat mati.
  tmux(
    "set-option", "-g", "remain-on-exit", "on", ";",
    "set-option", "-g", "status", "off", ";",
    // Prefix mati: tmux di sini adalah detail implementasi, dan C-b harus sampai ke claude.
    "set-option", "-g", "prefix", "None", ";",
    "set-option", "-g", "default-terminal", "screen-256color", ";",
    "new-session", "-d", "-s", name(id), "-c", cwd, cmd, ";",
    "set-option", "-t", name(id), "@hanoman_project", projectId, ";",
    "set-option", "-t", name(id), "@hanoman_cwd", cwd,
  );
  if (opts.specId) tmux("set-option", "-t", name(id), "@hanoman_spec", opts.specId);
  if (opts.flow) tmux("set-option", "-t", name(id), "@hanoman_flow", opts.flow);
  if (opts.phaseFile) tmux("set-option", "-t", name(id), "@hanoman_phase_file", opts.phaseFile);
  return { id, projectId, specId: opts.specId, flow: opts.flow, cwd, exited: false };
}

// Fase dibaca dari berkasnya, tidak disimpan: sesi yang selamat dari restart API tetap
// melaporkan fase yang benar tanpa map yang perlu dihidrasi ulang.
export function sessionPhases(id: string): Phase[] | null {
  const p = getSession(id);
  if (!p?.flow || !p.phaseFile) return null;
  return readPhases(p.phaseFile, p.flow);
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
function pollPhases(id: string, a: Attachment): void {
  const phases = sessionPhases(id);
  if (!phases) return;
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
      else pollPhases(id, attached.get(id)!);
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
