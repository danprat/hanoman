import { spawn, type IPty } from "node-pty";
import { randomUUID } from "node:crypto";
import { guardSettings } from "@hanoman/runner";
import { guardCommand } from "../runner/deps";

// Cukup untuk mengembalikan satu layar penuh plus riwayat, tanpa menahan memori tak
// terbatas untuk sesi yang menyala berhari-hari.
const MAX_SCROLLBACK = 256 * 1024;

export type Frame = { t: "data"; d: string } | { t: "exit"; code: number };
// Sengaja bukan `WebSocket`: service ini tidak boleh tahu soal transport, dan test
// menyuntikkan perekam frame biasa.
export type Client = { send(msg: string): void; close(): void };

export type Session = {
  id: string; projectId: string; runId?: string; cwd: string; pty: IPty;
  scrollback: string; exited: boolean; exitCode?: number; clients: Set<Client>;
};
export type SessionInfo = { id: string; projectId: string; runId?: string; cwd: string; exited: boolean };

const sessions = new Map<string, Session>();

// Variabel yang sama yang dipakai runner/src/claude-cli.ts.
const claudeBin = () => process.env.HANOMAN_CLAUDE_BIN ?? "claude";

function broadcast(s: Session, f: Frame): void {
  const msg = JSON.stringify(f);
  for (const c of s.clients) c.send(msg);
}

// node-pty mem-publish prebuilds/*/spawn-helper dengan mode 0644. Tanpa exec bit setiap
// fork mati dengan "posix_spawnp failed", pesan yang tidak menyebut node-pty sama sekali.
// `postinstall` di package.json memperbaikinya, tapi pnpm melewati script itu saat tree
// sudah up-to-date — jadi terjemahkan errornya alih-alih membiarkan orang menebak.
function spawnPty(cwd: string, resume?: string): IPty {
  // `--dangerously-skip-permissions` melewati prompt izin, bukan sistem hook. Tanpa
  // `--settings` di bawah, sesi ini tidak punya gerbang sama sekali — dan di bawah flag itu
  // PreToolUse adalah satu-satunya yang tersisa (ADR-0010).
  const args = [
    ...(resume ? ["--resume", resume] : []),
    "--dangerously-skip-permissions",
    "--settings", JSON.stringify(guardSettings(guardCommand())),
  ];
  try {
    return spawn(claudeBin(), args, {
      cwd, name: "xterm-256color", cols: 80, rows: 24,
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

export function createSession(
  projectId: string, cwd: string, opts: { runId?: string; resume?: string } = {},
): Session {
  const pty = spawnPty(cwd, opts.resume);
  const s: Session = {
    id: randomUUID().slice(0, 8), projectId, runId: opts.runId, cwd, pty,
    scrollback: "", exited: false, clients: new Set(),
  };
  pty.onData((d) => {
    s.scrollback = (s.scrollback + d).slice(-MAX_SCROLLBACK);
    broadcast(s, { t: "data", d });
  });
  // Sesi TIDAK dihapus dari map di sini: output terakhir sebuah sesi yang mati harus
  // masih bisa dibaca sampai pengguna menutup tabnya sendiri.
  pty.onExit(({ exitCode }) => {
    s.exited = true;
    s.exitCode = exitCode;
    broadcast(s, { t: "exit", code: exitCode });
    for (const c of s.clients) c.close();
    s.clients.clear();
  });
  sessions.set(s.id, s);
  return s;
}

export const getSession = (id: string): Session | undefined => sessions.get(id);

export const listSessions = (): SessionInfo[] =>
  [...sessions.values()].map(({ id, projectId, runId, cwd, exited }) => ({ id, projectId, runId, cwd, exited }));

export function killSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  if (!s.exited) s.pty.kill();
  sessions.delete(id);
  return true;
}

export function killAll(): void {
  for (const id of [...sessions.keys()]) killSession(id);
}

// Scrollback lebih dulu, baru live — inilah yang membuat reconnect terlihat mulus.
export function attach(s: Session, c: Client): void {
  s.clients.add(c);
  if (s.scrollback) c.send(JSON.stringify({ t: "data", d: s.scrollback } satisfies Frame));
  if (s.exited) {
    c.send(JSON.stringify({ t: "exit", code: s.exitCode ?? 0 } satisfies Frame));
    s.clients.delete(c);
    c.close();
  }
}

export const detach = (s: Session, c: Client): void => { s.clients.delete(c); };

export function writeTo(s: Session, d: string): void { if (!s.exited) s.pty.write(d); }

export function resize(s: Session, cols: number, rows: number): void {
  if (!s.exited) s.pty.resize(cols, rows);
}
