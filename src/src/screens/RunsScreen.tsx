/* RunsScreen — live Claude Code activity + controls. SPEC-008 wires the runner:
   subscribes to the SSE log stream for running/paused runs, exposes a terminal
   input + steer/pause/resume/stop, and shows a live duration (finishedAt, ADR-0007). */
import React from "react";
import { Card, StatusPill, Icon, usePaged, Pager, Button, IconButton, StateBlock } from "../ds";
import type { RunVM } from "./types";
import { subscribeRun, api } from "../api/client";
import { reduceRunEvent, runDurationMs, fmtDuration } from "./run-reduce";
import { isRunActive } from "@hanoman/shared";

const R_TRIGGER_ICON: Record<string, string> = {
  commit: "git-commit-horizontal", schedule: "calendar-clock",
  manual: "mouse-pointer-click", interval: "timer",
};

type Phase = { name: string; state: string };
type PlanStep = { label: string; state: string };
type FileRow = { path: string; add: number; del: number; status: string };
type LogLine = { t: string; s: string };

function PhasePipeline({ phases }: { phases: Phase[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
      {phases.map((p, i) => {
        const c = p.state === "done" ? "var(--leaf-500)" : p.state === "active" ? "var(--brass-500)"
          : p.state === "failed" ? "var(--clay-500)" : "var(--bone-400)";
        const icon = p.state === "done" ? "check" : p.state === "failed" ? "x" : null;
        return (
          <React.Fragment key={p.name}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%",
                background: p.state === "pending" ? "transparent" : c,
                border: p.state === "pending" ? "1.5px solid var(--bone-400)" : "none",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                animation: p.state === "active" ? "hn-pulse 1.4s ease-in-out infinite" : "none",
              }}>
                {icon && <Icon name={icon} size={13} stroke={3} color="#fff" />}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5,
                color: p.state === "pending" ? "var(--text-subtle)" : "var(--text-body)",
                fontWeight: p.state === "active" ? 600 : 400 }}>{p.name}</span>
            </div>
            {i < phases.length - 1 && (
              <span style={{ flex: 1, minWidth: 18, height: 2, marginTop: -18,
                background: phases[i]!.state === "done" ? "var(--leaf-500)" : "var(--bone-300)" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function MetricCell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="hn-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", fontWeight: 500,
        display: "flex", alignItems: "center", gap: 6 }}>{children}</div>
    </div>
  );
}

function PlanSteps({ steps }: { steps: PlanStep[] }) {
  const doneN = steps.filter((s) => s.state === "done").length;
  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", borderBottom: "1px solid var(--border-hair)" }}>
        <span className="hn-eyebrow">Plan · {steps.length} langkah</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{doneN}/{steps.length} selesai</span>
      </div>
      <div style={{ padding: "8px 16px 12px" }}>
        {steps.map((s, i) => {
          const done = s.state === "done", active = s.state === "active";
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <span style={{ width: 18, height: 18, borderRadius: "50%", flex: "0 0 auto",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: done ? "var(--leaf-500)" : active ? "var(--brass-500)" : "transparent",
                border: s.state === "pending" ? "1.5px solid var(--bone-400)" : "none",
                animation: active ? "hn-pulse 1.4s ease-in-out infinite" : "none" }}>
                {done && <Icon name="check" size={11} stroke={3} color="#fff" />}
                {active && <Icon name="loader" size={11} stroke={2.5} color="#fff" />}
              </span>
              <span style={{ fontSize: 13, color: s.state === "pending" ? "var(--text-subtle)" : "var(--text-body)",
                fontWeight: active ? 600 : 400 }}>{s.label}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FileDiff({ files }: { files: FileRow[] }) {
  const totAdd = files.reduce((n, f) => n + f.add, 0);
  const totDel = files.reduce((n, f) => n + f.del, 0);
  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", borderBottom: "1px solid var(--border-hair)" }}>
        <span className="hn-eyebrow">File berubah · {files.length}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
          <span style={{ color: "var(--leaf-600)" }}>+{totAdd}</span>{" "}
          <span style={{ color: "var(--clay-600)" }}>−{totDel}</span>
        </span>
      </div>
      <div style={{ padding: "8px 16px 12px" }}>
        {files.map((f) => (
          <div key={f.path} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0" }}>
            <Icon name={f.status === "added" ? "file-plus" : "file-diff"} size={14}
              color={f.status === "added" ? "var(--leaf-600)" : "var(--wind-600)"} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, flex: "0 0 auto" }}>
              <span style={{ color: "var(--leaf-600)" }}>+{f.add}</span>{" "}
              <span style={{ color: "var(--clay-600)" }}>−{f.del}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RunListRow({ run, active, onClick, onDelete }:
  { run: RunVM; active: boolean; onClick: () => void; onDelete?: (r: RunVM) => void }) {
  const [hover, setHover] = React.useState(false);
  const busy = isRunActive(run.status);
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
      padding: "12px 14px", borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
      background: active ? "var(--brass-050)" : (hover ? "var(--bone-100)" : "transparent"),
      borderBottom: "1px solid var(--border-hair)", transition: "background 120ms ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{run.id}</span>
        <StatusPill status={run.status} size="sm" />
        {onDelete && !busy && hover && (
          <span onClick={(e) => { e.stopPropagation(); onDelete(run); }}>
            <IconButton size="sm" variant="ghost" icon="trash-2" label={"Hapus run " + run.id} />
          </span>
        )}
      </div>
      <div style={{ fontSize: 13.5, color: "var(--text-strong)", fontWeight: 500, marginTop: 5 }}>{run.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
        <Icon name="box" size={12} /> {run.project}
        <span style={{ color: "var(--bone-400)" }}>·</span>
        <Icon name={R_TRIGGER_ICON[run.trigger]!} size={12} /> {run.trigger}
      </div>
    </div>
  );
}

function WorktreeInfo({ run }: { run: RunVM }) {
  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border-hair)" }}>
        <Icon name="git-branch" size={15} color="var(--brass-600)" />
        <span className="hn-eyebrow">Git worktree</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>
          <Icon name="folder-git-2" size={13} /> {run.worktree}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-body)" }}>
        <span>{run.branchFrom}</span>
        <Icon name="arrow-right" size={15} color="var(--text-subtle)" />
        <span>{run.branchTo}</span>
      </div>
    </Card>
  );
}

function LogView({ run }: { run: RunVM }) {
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const live = run.status === "running" || run.status === "paused";
  const log = run.log as LogLine[];
  React.useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [log.length]);
  const lineColor = (t: string) => t === "✓" ? "var(--leaf-500)" : t === "✗" ? "var(--clay-500)" : t === "$" ? "var(--term-dim)" : "var(--brass-400)";
  return (
    <div style={{ background: "var(--surface-code)", borderRadius: "var(--radius-lg)", border: "1px solid var(--term-line)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px", borderBottom: "1px solid var(--term-line)" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "0 0 auto",
          background: live ? "var(--leaf-500)" : "var(--term-dim)",
          animation: run.status === "running" ? "hn-pulse 1.4s ease-in-out infinite" : "none" }} />
        <Icon name="terminal" size={13} color="var(--term-dim)" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--term-dim)" }}>claude code · {run.id}</span>
      </div>
      <div ref={bodyRef} style={{ padding: "14px 16px", maxHeight: 300, overflow: "auto",
        fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.85, color: "var(--term-fg)" }}>
        {log.length === 0 && <div style={{ color: "var(--term-dim)" }}>— log kosong —</div>}
        {log.map((l, i) => (
          <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <span style={{ color: lineColor(l.t), marginRight: 8 }}>{l.t}</span>
            <span style={{ color: l.t === "$" || l.t === " " ? "var(--term-dim)" : "var(--term-fg)" }}>{l.s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Ticks once a second while the run is active so the elapsed time stays live.
function useLiveDuration(run: RunVM): string {
  const running = run.status === "running" || run.status === "paused";
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return fmtDuration(runDurationMs(run, running ? now : Date.now()));
}

// Terminal input + control buttons for an active run (drives /command + /control).
function RunControls({ run }: { run: RunVM }) {
  const [text, setText] = React.useState("");
  const send = async () => { const t = text.trim(); if (!t) return; setText(""); await api.runCommand(run.id, t); };
  const ctl = (action: "pause" | "resume" | "stop") => () => { void api.runControl(run.id, action); };
  return (
    <Card padding={14}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
          placeholder="ketik perintah / arahan untuk run… (steer, pause, resume, stop, docs <path>)"
          style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, padding: "8px 10px",
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)", background: "var(--surface-code)", color: "var(--term-fg)" }} />
        <Button size="sm" leftIcon="send" onClick={() => void send()}>Kirim</Button>
        {run.status === "paused"
          ? <Button size="sm" variant="secondary" leftIcon="play" onClick={ctl("resume")}>Resume</Button>
          : <Button size="sm" variant="secondary" leftIcon="pause" onClick={ctl("pause")}>Pause</Button>}
        <Button size="sm" variant="ghost" leftIcon="square" onClick={ctl("stop")}>Stop</Button>
      </div>
    </Card>
  );
}

function RunDetail({ run }: { run: RunVM }) {
  const hasWork = (run.plan as PlanStep[]).length > 0 || (run.files as FileRow[]).length > 0;
  const duration = useLiveDuration(run);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card padding={20}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div>
            <div className="hn-eyebrow" style={{ marginBottom: 6 }}>{run.id} · {run.kind}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-strong)" }}>
              {run.title}
            </div>
          </div>
          <StatusPill status={run.status} />
        </div>
        <PhasePipeline phases={run.phases as Phase[]} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14, marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border-hair)" }}>
          <MetricCell label="Project"><Icon name="box" size={13} color="var(--text-muted)" /> {run.project}</MetricCell>
          <MetricCell label="Spec">{run.spec || "—"}</MetricCell>
          <MetricCell label="Trigger"><Icon name={R_TRIGGER_ICON[run.trigger]!} size={13} color="var(--text-muted)" /> {run.trigger}</MetricCell>
          <MetricCell label="Durasi">{duration}</MetricCell>
          <MetricCell label="Tokens">{run.tokensIn} / {run.tokensOut}</MetricCell>
          <MetricCell label="Estimasi biaya">{run.cost}</MetricCell>
        </div>
      </Card>
      <WorktreeInfo run={run} />
      {hasWork && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
          <PlanSteps steps={run.plan as PlanStep[]} />
          <FileDiff files={run.files as FileRow[]} />
        </div>
      )}
      <LogView run={run} />
      {(run.status === "running" || run.status === "paused") && <RunControls run={run} />}
    </div>
  );
}

export function RunsScreen({ runs, selectedId, pageSize = 4, onDelete, onGotoBacklog }:
  { runs: RunVM[]; selectedId?: string; pageSize?: number; onDelete?: (r: RunVM) => void; onGotoBacklog?: () => void }) {
  const [selId, setSelId] = React.useState(selectedId || (runs[0] && runs[0].id));
  const pg = usePaged(runs, pageSize, "runs");
  const picked = runs.find((r) => r.id === selId) || runs[0];
  // Live overlay: seed from the picked run, merge SSE events while it's active.
  // Re-seed saat id ATAU status berubah. Poll 3 dtk membawa status baru dari DB, tapi
  // overlay ini di-snapshot sekali per run — tanpa `status` di deps, panel detail
  // tertinggal di `queued` walau baris daftar sudah `running`. Redis pub/sub tak punya
  // replay, jadi event `running` yang terbit sebelum langganan SSE dibuka hilang untuk
  // selamanya dan status berikutnya baru datang saat run selesai (SPEC-142).
  const [live, setLive] = React.useState<RunVM | undefined>(picked);
  React.useEffect(() => { setLive(picked); }, [picked?.id, picked?.status]);
  React.useEffect(() => {
    if (!picked) return;
    if (picked.status !== "running" && picked.status !== "paused") return;
    const off = subscribeRun(picked.id, (e) => setLive((cur) => cur ? reduceRunEvent(cur, e) : cur));
    return off;
  }, [picked?.id, picked?.status]);
  const active = live ?? picked;
  if (!active) return <StateBlock kind="empty" icon="activity" title="Belum ada run"
    hint="Jalankan spec dari backlog — log Claude Code akan streaming di sini."
    action={onGotoBacklog} actionLabel="Buka backlog" actionIcon="list-checks" />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>
      <Card padding={0}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-hair)" }}>
          <span className="hn-eyebrow">Activity · {runs.length} runs</span>
        </div>
        {pg.pageItems.map((r) => <RunListRow key={r.id} run={r} active={r.id === active.id} onClick={() => setSelId(r.id)} onDelete={onDelete} />)}
        <Pager {...pg} onPage={pg.setPage} unit="run" />
      </Card>
      <RunDetail run={active} />
    </div>
  );
}
