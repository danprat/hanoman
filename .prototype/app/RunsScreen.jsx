/* RunsScreen — live Claude Code activity, now INTERACTIVE.
   Click a run to focus it. For a live run the human is always in
   control (even in full-auto): steer an instruction into the run,
   interrupt (pause), resume, or stop. A gentle ticker makes the
   selected running run feel alive; steering/pausing act on it. */
const { Card: RCard, StatusPill: RPill, Badge: RBadge, Button: RBtn, IconButton: RIconBtn,
        Input: RInput, Switch: RSwitch, Select: RSelect, Icon: RIcon, Callout: RCallout } =
  window.HanomanDesignSystem_c639ad;

const R_TRIGGER_ICON = {
  commit: "git-commit-horizontal", schedule: "calendar-clock",
  manual: "mouse-pointer-click", interval: "timer",
};

const R_TICK_LINES = [
  { t: "›", s: "membaca internal/docs/architecture/data-model.md" },
  { t: "›", s: "menerapkan patch · consumer retry" },
  { t: "✓", s: "unit test hijau · 12 passed" },
  { t: "›", s: "menautkan doc yang tersentuh" },
  { t: "›", s: "menyusun diff untuk ditinjau" },
];

function PhasePipeline({ phases }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
      {phases.map((p, i) => {
        const c = p.state === "done" ? "var(--leaf-500)"
          : p.state === "active" ? "var(--brass-500)"
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
                {icon && <RIcon name={icon} size={13} stroke={3} color="#fff" />}
              </span>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 10.5,
                color: p.state === "pending" ? "var(--text-subtle)" : "var(--text-body)",
                fontWeight: p.state === "active" ? 600 : 400,
              }}>{p.name}</span>
            </div>
            {i < phases.length - 1 && (
              <span style={{ flex: 1, minWidth: 18, height: 2, marginTop: -18,
                background: phases[i].state === "done" ? "var(--leaf-500)" : "var(--bone-300)" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function MetricCell({ label, children, mono = true }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="hn-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: 13, color: "var(--text-strong)", fontWeight: 500,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        {children}
      </div>
    </div>
  );
}

function PlanSteps({ steps }) {
  const doneN = steps.filter((s) => s.state === "done").length;
  return (
    <RCard padding={0}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", borderBottom: "1px solid var(--border-hair)" }}>
        <span className="hn-eyebrow">Plan · {steps.length} langkah</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{doneN}/{steps.length} selesai</span>
      </div>
      <div style={{ padding: "8px 16px 12px" }}>
        {steps.map((s, i) => {
          const done = s.state === "done", active = s.state === "active";
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%", flex: "0 0 auto",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: done ? "var(--leaf-500)" : active ? "var(--brass-500)" : "transparent",
                border: s.state === "pending" ? "1.5px solid var(--bone-400)" : "none",
                animation: active ? "hn-pulse 1.4s ease-in-out infinite" : "none",
              }}>
                {done && <RIcon name="check" size={11} stroke={3} color="#fff" />}
                {active && <RIcon name="loader" size={11} stroke={2.5} color="#fff" />}
              </span>
              <span style={{
                fontSize: 13, color: s.state === "pending" ? "var(--text-subtle)" : "var(--text-body)",
                fontWeight: active ? 600 : 400,
              }}>{s.label}</span>
            </div>
          );
        })}
      </div>
    </RCard>
  );
}

function FileDiff({ files }) {
  const totAdd = files.reduce((n, f) => n + f.add, 0);
  const totDel = files.reduce((n, f) => n + f.del, 0);
  return (
    <RCard padding={0}>
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
            <RIcon name={f.status === "added" ? "file-plus" : "file-diff"} size={14}
              color={f.status === "added" ? "var(--leaf-600)" : "var(--wind-600)"} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, flex: "0 0 auto" }}>
              <span style={{ color: "var(--leaf-600)" }}>+{f.add}</span>{" "}
              <span style={{ color: "var(--clay-600)" }}>−{f.del}</span>
            </span>
          </div>
        ))}
      </div>
    </RCard>
  );
}

function RunListRow({ run, active, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
      padding: "12px 14px", borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
      background: active ? "var(--brass-050)" : (hover ? "var(--bone-100)" : "transparent"),
      borderBottom: "1px solid var(--border-hair)", transition: "background 120ms ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{run.id}</span>
        <RPill status={run.status} size="sm" />
      </div>
      <div style={{ fontSize: 13.5, color: "var(--text-strong)", fontWeight: 500, marginTop: 5 }}>{run.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
        <RIcon name="box" size={12} /> {run.project}
        <span style={{ color: "var(--bone-400)" }}>·</span>
        <RIcon name={R_TRIGGER_ICON[run.trigger]} size={12} /> {run.trigger}
      </div>
    </div>
  );
}

/* ---- human-in-control bar: mode, steer, interrupt/resume/stop ---- */
function ControlBar({ run, auto, onAuto, onSteer, onPause, onResume, onStop }) {
  const [msg, setMsg] = React.useState("");
  const paused = run.status === "paused";
  const send = () => { const t = msg.trim(); if (!t) return; onSteer(t); setMsg(""); };
  return (
    <RCard padding={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <RIcon name="user-round-cog" size={15} color="var(--brass-600)" />
          <span className="hn-eyebrow">Kendali manusia</span>
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: auto ? "var(--text-strong)" : "var(--text-muted)" }}>
            {auto ? "Full auto" : "Manual"}
          </span>
          <RSwitch checked={auto} onChange={onAuto} size="sm" />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {paused
            ? <RBtn size="sm" leftIcon="play" onClick={onResume}>Lanjutkan</RBtn>
            : <RBtn size="sm" variant="secondary" leftIcon="pause" onClick={onPause}>Interupsi</RBtn>}
          <RBtn size="sm" variant="danger" leftIcon="square" onClick={onStop}>Hentikan</RBtn>
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px" }}>
        <RInput size="sm" leftIcon="messages-square" placeholder="Arahkan run ini — mis. \u201cpakai backoff maks 30 dtk\u201d\u2026"
          value={msg} onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          style={{ flex: 1 }} />
        <RBtn size="sm" leftIcon="send-horizontal" onClick={send}>Steer</RBtn>
      </div>
      <div style={{ padding: "0 16px 12px", fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {paused
          ? "Run dijeda. Tinjau, arahkan, lalu lanjutkan — atau hentikan."
          : auto
            ? "Full auto: run berjalan sendiri sampai selesai. Kamu tetap bisa menyisipkan arahan atau menginterupsi kapan saja — manusia pegang kendali penuh."
            : "Manual: setiap langkah menunggu arahanmu sebelum lanjut."}
      </div>
    </RCard>
  );
}

const R_TERM_HELP = "perintah: help · status · plan · files · steer <pesan> · pause · resume · stop · docs <path> · clear";

/* Interactive Claude Code terminal: scrollable output + a prompt you
   can type into. Commands are interpreted by onCommand (in RunsScreen);
   the input keeps a per-run command history (↑/↓). */
function Terminal({ run, onCommand }) {
  const [cmd, setCmd] = React.useState("");
  const [hist, setHist] = React.useState([]);
  const [hi, setHi] = React.useState(-1);
  const bodyRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const live = run.status === "running" || run.status === "paused";
  React.useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [run.log.length]);

  const submit = () => {
    const t = cmd.trim(); if (!t) return;
    setHist((h) => [t, ...h].slice(0, 40)); setHi(-1);
    onCommand(t); setCmd("");
  };
  const onKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => { const n = Math.min(hist.length - 1, i + 1); if (hist[n] != null) setCmd(hist[n]); return n; }); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => { const n = Math.max(-1, i - 1); setCmd(n < 0 ? "" : (hist[n] || "")); return n; }); }
  };
  const lineColor = (t) => t === "✓" ? "var(--leaf-500)" : t === "✗" ? "var(--clay-500)" : t === "$" ? "var(--term-dim)" : "var(--brass-400)";

  return (
    <div style={{
      background: "var(--surface-code)", borderRadius: "var(--radius-lg)",
      border: "1px solid var(--term-line)", overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 9, padding: "9px 14px",
        borderBottom: "1px solid var(--term-line)",
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%", flex: "0 0 auto",
          background: live ? "var(--leaf-500)" : "var(--term-dim)",
          animation: run.status === "running" ? "hn-pulse 1.4s ease-in-out infinite" : "none",
        }} />
        <RIcon name="terminal" size={13} color="var(--term-dim)" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--term-dim)" }}>
          claude code · {run.id}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => onCommand("clear")} title="Bersihkan" style={{
          border: "none", background: "transparent", cursor: "pointer", color: "var(--term-dim)",
          display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font-mono)", fontSize: 11, padding: 2,
        }}>
          <RIcon name="eraser" size={13} /> clear
        </button>
      </div>

      <div ref={bodyRef} onClick={() => inputRef.current && inputRef.current.focus()} style={{
        padding: "14px 16px", maxHeight: 300, overflow: "auto", cursor: "text",
        fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.85, color: "var(--term-fg)",
      }}>
        {run.log.length === 0 && (
          <div style={{ color: "var(--term-dim)" }}>— log kosong — ketik <span style={{ color: "var(--brass-400)" }}>help</span></div>
        )}
        {run.log.map((l, i) => (
          <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <span style={{ color: lineColor(l.t), marginRight: 8 }}>{l.t}</span>
            <span style={{ color: l.t === "$" || l.t === " " ? "var(--term-dim)" : "var(--term-fg)" }}>{l.s}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <span style={{ color: "var(--brass-400)", flex: "0 0 auto" }}>hanoman ›</span>
          <input ref={inputRef} value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={onKey}
            spellCheck={false} autoComplete="off" placeholder="ketik perintah — coba `help`"
            style={{
              flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent",
              color: "var(--term-fg)", fontFamily: "var(--font-mono)", fontSize: 12, caretColor: "var(--brass-400)",
            }} />
        </div>
      </div>
    </div>
  );
}

/* Git worktree: each run is isolated in its own worktree, can pull from
   any base branch and push results to any target branch. Both switchable. */
function WorktreePanel({ run, branches, onWorktree }) {
  const opts = [...new Set([run.branchFrom, run.branchTo, ...(branches || [])])].map((b) => ({ value: b, label: b }));
  const BranchSelect = ({ label, field, value }) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span className="hn-eyebrow">{label}</span>
      <RSelect size="sm" value={value} onChange={(e) => onWorktree(field, e.target.value)} options={opts} style={{ width: 190 }} />
    </label>
  );
  return (
    <RCard padding={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border-hair)" }}>
        <RIcon name="git-branch" size={15} color="var(--brass-600)" />
        <span className="hn-eyebrow">Git worktree</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>
          <RIcon name="folder-git-2" size={13} /> {run.worktree}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, padding: "14px 16px", flexWrap: "wrap" }}>
        <BranchSelect label="Pull dari" field="branchFrom" value={run.branchFrom} />
        <span style={{ paddingBottom: 7 }}><RIcon name="arrow-right" size={16} color="var(--text-subtle)" /></span>
        <BranchSelect label="Push ke" field="branchTo" value={run.branchTo} />
        <span style={{ flex: 1, minWidth: 160, paddingBottom: 6, fontSize: 12, color: "var(--text-subtle)", lineHeight: 1.5 }}>
          Run terisolasi di worktree sendiri — pull dari branch mana pun, push ke branch mana pun tanpa mengganggu run lain.
        </span>
      </div>
    </RCard>
  );
}

function RunDetail({ run, auto, onAuto, onSteer, onPause, onResume, onStop, onRetry, onCommand, branches, onWorktree }) {
  const hasWork = run.plan.length > 0 || run.files.length > 0;
  const live = run.status === "running" || run.status === "paused";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <RCard padding={20}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div>
            <div className="hn-eyebrow" style={{ marginBottom: 6 }}>{run.id} · {run.kind}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-strong)" }}>
              {run.title}
            </div>
          </div>
          <RPill status={run.status} />
        </div>

        <PhasePipeline phases={run.phases} />

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14,
          marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border-hair)",
        }}>
          <MetricCell label="Project"><RIcon name="box" size={13} color="var(--text-muted)" /> {run.project}</MetricCell>
          <MetricCell label="Spec">{run.spec || "—"}</MetricCell>
          <MetricCell label="Trigger"><RIcon name={R_TRIGGER_ICON[run.trigger]} size={13} color="var(--text-muted)" /> {run.trigger}</MetricCell>
          <MetricCell label="Durasi">{run.duration}</MetricCell>
          <MetricCell label="Tokens">{run.tokensIn} / {run.tokensOut}</MetricCell>
          <MetricCell label="Biaya">{run.cost}</MetricCell>
        </div>
      </RCard>

      <WorktreePanel run={run} branches={branches} onWorktree={onWorktree} />

      {live && (
        <ControlBar run={run} auto={auto} onAuto={onAuto} onSteer={onSteer}
          onPause={onPause} onResume={onResume} onStop={onStop} />
      )}

      {run.status === "failed" && (
        <RCallout tone="err" title="Plan diblok — docs adalah Source of Truth"
          action={<RBtn size="sm" leftIcon="refresh-cw" onClick={onRetry}>Re-scan docs & retry</RBtn>}>
          Plan tak bisa lanjut sampai docs yang jadi acuannya diperbarui. Perbaiki index-nya, lalu jalankan ulang.
        </RCallout>
      )}
      {run.status === "stopped" && (
        <RCallout tone="warn" title="Run dihentikan oleh manusia"
          action={<RBtn size="sm" leftIcon="refresh-cw" onClick={onRetry}>Jalankan ulang</RBtn>}>
          Kamu menghentikan run ini. Progres tersimpan; jalankan ulang kapan pun siap.
        </RCallout>
      )}

      {hasWork && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
          <PlanSteps steps={run.plan} />
          <FileDiff files={run.files} />
        </div>
      )}

      <Terminal run={run} onCommand={onCommand} />
    </div>
  );
}

function RunsScreen({ runs, selectedId, pageSize = 4 }) {
  const [runList, setRunList] = React.useState(() => runs.map((r) => ({ ...r, log: r.log.slice() })));
  const [selId, setSelId] = React.useState(selectedId || runs[0].id);
  const [auto, setAuto] = React.useState(true);
  const tickRef = React.useRef(0);
  const { usePaged, Pager } = window;
  const pg = usePaged(runList, pageSize, "runs");

  const active = runList.find((r) => r.id === selId) || runList[0];

  const patchSel = (fn) => setRunList((list) => list.map((r) => r.id === selId ? fn(r) : r));

  // gentle live ticker for the selected running run (full auto)
  React.useEffect(() => {
    if (!(active.status === "running" && auto)) return;
    const iv = setInterval(() => {
      setRunList((list) => list.map((r) => {
        if (r.id !== selId || r.status !== "running") return r;
        const line = R_TICK_LINES[tickRef.current % R_TICK_LINES.length];
        tickRef.current += 1;
        return { ...r, log: [...r.log, line], progress: Math.min(99, (r.progress || 0) + 4) };
      }));
    }, 2800);
    return () => clearInterval(iv);
  }, [selId, active.status, auto]);

  const steer = (text) => patchSel((r) => ({ ...r, log: [...r.log, { t: "»", s: "steer · " + text }] }));
  const pause = () => patchSel((r) => ({ ...r, status: "paused", log: [...r.log, { t: " ", s: "— dijeda oleh manusia —" }] }));
  const resume = () => patchSel((r) => ({ ...r, status: "running", log: [...r.log, { t: "›", s: "dilanjutkan oleh manusia" }] }));
  const stop = () => patchSel((r) => ({ ...r, status: "stopped", log: [...r.log, { t: "✗", s: "dihentikan oleh manusia" }] }));
  const retry = () => patchSel((r) => ({
    ...r, status: "running",
    phases: r.phases.map((p) => p.state === "failed" ? { ...p, state: "active" } : p),
    log: [...r.log, { t: "›", s: "re-scan docs · dijalankan ulang oleh manusia" }],
  }));

  // interactive terminal command interpreter
  const setBranch = (field, value) => patchSel((r) => ({
    ...r, [field]: value,
    log: [...r.log, { t: "›", s: field === "branchFrom"
      ? ("checkout " + value + " · worktree " + r.worktree)
      : ("target branch → " + value) }],
  }));
  const runCommand = (text) => patchSel((r) => {
    const parts = text.trim().split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();
    const arg = parts.slice(1).join(" ");
    if (cmd === "clear") return { ...r, log: [] };
    const echo = { t: "$", s: text };
    let status = r.status, lines;
    switch (cmd) {
      case "help":
        lines = [{ t: " ", s: R_TERM_HELP }]; break;
      case "status": {
        const ph = (r.phases.find((p) => p.state === "active") || {}).name || "—";
        lines = [{ t: "›", s: `${r.id} · ${r.status} · ${r.kind} · fase ${ph} · ${r.progress || 0}%` }]; break;
      }
      case "plan":
        lines = r.plan.length
          ? r.plan.map((s) => ({ t: s.state === "done" ? "✓" : s.state === "active" ? "›" : " ", s: s.label }))
          : [{ t: " ", s: "belum ada plan untuk run ini" }]; break;
      case "files": case "diff":
        lines = r.files.length
          ? r.files.map((f) => ({ t: f.status === "added" ? "✓" : "›", s: `${f.path}  +${f.add} −${f.del}` }))
          : [{ t: " ", s: "belum ada file berubah" }]; break;
      case "steer":
        lines = arg
          ? [{ t: "»", s: "steer · " + arg }, { t: "›", s: "diterima — arahan disisipkan ke langkah berikutnya" }]
          : [{ t: " ", s: "pakai: steer <pesan>" }]; break;
      case "pause": status = "paused"; lines = [{ t: " ", s: "— dijeda oleh manusia —" }]; break;
      case "resume": status = "running"; lines = [{ t: "›", s: "dilanjutkan oleh manusia" }]; break;
      case "stop": status = "stopped"; lines = [{ t: "✗", s: "dihentikan oleh manusia" }]; break;
      case "docs":
        lines = arg ? [{ t: "›", s: "membuka internal/docs/" + arg }] : [{ t: " ", s: "pakai: docs <path>" }]; break;
      default:
        lines = [{ t: "›", s: "claude: \u201c" + text + "\u201d diterima — memproses dalam konteks run" }];
    }
    return { ...r, status, log: [...r.log, echo, ...lines] };
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>
      <RCard padding={0}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-hair)" }}>
          <span className="hn-eyebrow">Activity · {runList.length} runs</span>
        </div>
        {pg.pageItems.map((r) => <RunListRow key={r.id} run={r} active={r.id === active.id} onClick={() => setSelId(r.id)} />)}
        <Pager {...pg} onPage={pg.setPage} unit="run" />
      </RCard>
      <RunDetail run={active} auto={auto} onAuto={setAuto} onSteer={steer}
        onPause={pause} onResume={resume} onStop={stop} onRetry={retry} onCommand={runCommand}
        branches={window.HN.branches} onWorktree={setBranch} />
    </div>
  );
}

Object.assign(window, { RunsScreen });
