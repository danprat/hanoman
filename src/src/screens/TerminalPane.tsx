import React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { paths } from "@hanoman/shared";
import type { Phase } from "../api/client";

export function TerminalPane({ sessionId, onExit, onPhases }: {
  sessionId: string; onExit: (code: number) => void; onPhases?: (p: Phase[]) => void;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  // onExit boleh berubah tiap render; menaruhnya di ref menjaga effect ini
  // hanya bergantung pada sessionId — remount = sesi yang benar-benar berbeda.
  const exitRef = React.useRef(onExit);
  exitRef.current = onExit;
  const phaseRef = React.useRef(onPhases);
  phaseRef.current = onPhases;

  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    const css = getComputedStyle(document.documentElement);
    const token = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback;
    const term = new Terminal({
      fontFamily: token("--font-mono", "monospace"),
      fontSize: 13, cursorBlink: true,
      theme: { background: token("--term-bg", "#1c1810"), foreground: token("--term-fg", "#e9e0cd") },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${scheme}//${location.host}${paths.terminalWs(sessionId)}`);
    const send = (m: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

    ws.onopen = () => { term.focus(); send({ t: "resize", cols: term.cols, rows: term.rows }); };
    ws.onmessage = (ev) => {
      const f = JSON.parse(ev.data as string) as { t: string; d?: string; code?: number; phases?: Phase[] };
      if (f.t === "data") term.write(f.d ?? "");
      // Server menyiarkan fase saat attach dan setiap kali agen menutup satu (SPEC-162).
      else if (f.t === "phase") phaseRef.current?.(f.phases ?? []);
      else if (f.t === "exit") {
        term.write(`\r\n\x1b[33m— sesi berakhir (exit ${f.code}) —\x1b[0m\r\n`);
        exitRef.current(f.code ?? 0);
      }
    };
    const typed = term.onData((d) => send({ t: "in", d }));
    const ro = new ResizeObserver(() => {
      fit.fit();
      send({ t: "resize", cols: term.cols, rows: term.rows });
    });
    ro.observe(el);

    return () => { ro.disconnect(); typed.dispose(); ws.close(); term.dispose(); };
  }, [sessionId]);

  return <div ref={host} style={{ height: "100%", width: "100%", background: "var(--term-bg)", padding: 8, borderRadius: "var(--radius-sm)" }} />;
}
