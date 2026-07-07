/* flows.jsx — the human → hanoman input flows that produce the
   backlog and runs seen elsewhere:
     IdeaFlow     — from-scratch idea → brainstorm → locked MVP objective
     BriefForm    — human writes a feature brief
     QaForm       — human files a QA finding
     ScaffoldDocs — hanoman scaffolds the full doc index (Source of Truth)
   Static, pre-filled examples. */
const {
  Card: FCard, Button: FBtn, Input: FInput, Select: FSelect, Tabs: FTabs,
  Badge: FBadge, Icon: FIcon, Callout: FCallout, ProgressBar: FBar,
} = window.HanomanDesignSystem_c639ad;

const F_PROJECT_OPTS = () => window.HN.projects.map((p) => ({ value: p.id, label: p.name }));

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-body)" }}>{label}</span>
        {hint && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-subtle)" }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function Stepper({ steps }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{
              width: 30, height: 30, borderRadius: "50%", flex: "0 0 auto",
              background: "var(--brass-100)", color: "var(--brass-700)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
              <FIcon name={s.icon} size={15} />
            </span>
            {i < steps.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 16, background: "var(--bone-300)", margin: "3px 0" }} />}
          </div>
          <div style={{ paddingTop: 5, paddingBottom: 16 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 2 }}>
              {String(i + 1).padStart(2, "0")}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.4 }}>{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Idea → brainstorm → MVP objective ---------------- */
function ThreadMessage({ msg }) {
  const bot = msg.who === "hanoman";
  return (
    <div style={{ display: "flex", gap: 11, padding: "12px 0", borderBottom: "1px solid var(--border-hair)" }}>
      <span style={{
        width: 26, height: 26, borderRadius: bot ? "var(--radius-sm)" : "50%", flex: "0 0 auto",
        background: bot ? "var(--accent)" : "var(--wind-100)",
        color: bot ? "var(--ink-900)" : "var(--wind-700)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
      }}>
        {bot ? <FIcon name="wind" size={15} stroke={2.4} /> : (msg.name || "Ra").slice(0, 2)}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: bot ? "var(--brass-700)" : "var(--wind-700)", marginBottom: 3 }}>
          {bot ? "hanoman" : msg.name}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--text-body)", lineHeight: 1.5 }}>{msg.text}</div>
      </div>
    </div>
  );
}

function IdeaFlow({ idea }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20, alignItems: "start" }}>
      <FCard padding={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-hair)" }}>
          <div className="hn-eyebrow" style={{ marginBottom: 5 }}>Brainstorm · from-scratch</div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 500, color: "var(--text-strong)" }}>{idea.project}</span>
            <FBadge tone="brass" size="sm">from-scratch</FBadge>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>· {idea.tagline}</span>
          </div>
        </div>
        <div style={{ padding: "2px 18px 12px" }}>
          {idea.thread.map((m, i) => <ThreadMessage key={i} msg={m} />)}
        </div>
        <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid var(--border-hair)", background: "var(--bone-100)" }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-strong)", background: "var(--surface-card)", color: "var(--text-subtle)", fontSize: 13 }}>
            <FIcon name="message-square" size={14} /> Tulis balasan ke hanoman…
          </div>
          <FBtn size="sm" variant="secondary" leftIcon="send">Kirim</FBtn>
        </div>
      </FCard>

      <FCard padding={20} style={{ border: "1px solid var(--brass-300)", boxShadow: "var(--shadow-gild)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span className="hn-eyebrow">MVP objective</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: "var(--radius-pill)", background: "var(--leaf-100)", color: "var(--leaf-600)", fontSize: 11, fontWeight: 600 }}>
            <FIcon name="lock" size={11} /> terkunci
          </span>
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 19, lineHeight: 1.35, letterSpacing: "-0.01em", color: "var(--text-strong)", marginBottom: 18 }}>
          {idea.objective}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14, marginBottom: 18 }}>
          <div>
            <div className="hn-eyebrow" style={{ marginBottom: 8 }}>In scope</div>
            {idea.inScope.map((s) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13, color: "var(--text-body)" }}>
                <FIcon name="check" size={14} color="var(--leaf-600)" stroke={2.6} /> {s}
              </div>
            ))}
          </div>
          <div>
            <div className="hn-eyebrow" style={{ marginBottom: 8 }}>Out of scope</div>
            {idea.outScope.map((s) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13, color: "var(--text-subtle)" }}>
                <FIcon name="minus" size={14} color="var(--text-subtle)" stroke={2.6} /> {s}
              </div>
            ))}
          </div>
        </div>
        <FBtn fullWidth leftIcon="book-open" rightIcon="arrow-right">Scaffold doc index</FBtn>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          <em>Anoman Duta</em> — objective jadi bukti sebelum satu baris dieksekusi.
        </div>
      </FCard>
    </div>
  );
}

/* ---------------- Feature brief ---------------- */
function BriefForm({ brief }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 20, alignItems: "start" }}>
      <FCard eyebrow="Human · brief" title="Feature brief" padding={20}>
        <Field label="Project">
          <FSelect defaultValue={brief.project} options={F_PROJECT_OPTS()} />
        </Field>
        <Field label="Judul brief">
          <FInput defaultValue={brief.title} />
        </Field>
        <Field label="Problem / konteks" hint="apa yang sakit">
          <textarea className="hn-ta" rows={3} defaultValue={brief.problem} />
        </Field>
        <Field label="Outcome yang diharapkan" hint="definisi selesai">
          <textarea className="hn-ta" rows={3} defaultValue={brief.outcome} />
        </Field>
        <Field label="Constraints">
          <textarea className="hn-ta" rows={2} defaultValue={brief.constraints} />
        </Field>
        <Field label="Prioritas">
          <FTabs variant="pill" defaultValue="sedang" tabs={[
            { value: "rendah", label: "Rendah" }, { value: "sedang", label: "Sedang" }, { value: "tinggi", label: "Tinggi" },
          ]} />
        </Field>
        <FCallout tone="info" title="Acceptance criteria (EARS)">
          hanoman menurunkan acceptance criteria format EARS saat menulis spec — kamu tak perlu menulisnya di sini.
        </FCallout>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <FBtn leftIcon="send">Kirim ke hanoman</FBtn>
          <FBtn variant="secondary">Simpan draft</FBtn>
        </div>
      </FCard>

      <FCard eyebrow="Setelah dikirim" title="Alur hanoman" padding={20}>
        <Stepper steps={brief.nextSteps} />
        <div style={{ marginTop: 4, paddingTop: 14, borderTop: "1px solid var(--border-hair)", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          hanoman brainstorm dulu sampai objective jelas, baru menulis spec dan menaruhnya di backlog untuk plan → execute.
        </div>
      </FCard>
    </div>
  );
}

/* ---------------- QA finding ---------------- */
function QaForm({ qa }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 20, alignItems: "start" }}>
      <FCard eyebrow="Human · finding" title="QA finding" padding={20}>
        <Field label="Project">
          <FSelect defaultValue={qa.project} options={F_PROJECT_OPTS()} />
        </Field>
        <Field label="Judul finding">
          <FInput defaultValue={qa.title} />
        </Field>
        <Field label="Severity">
          <FTabs variant="pill" defaultValue="major" tabs={[
            { value: "blocker", label: "Blocker" }, { value: "major", label: "Major" }, { value: "minor", label: "Minor" },
          ]} />
        </Field>
        <Field label="Langkah reproduksi">
          <textarea className="hn-ta" rows={3} defaultValue={qa.steps} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Hasil diharapkan">
            <textarea className="hn-ta" rows={2} defaultValue={qa.expected} />
          </Field>
          <Field label="Hasil aktual">
            <textarea className="hn-ta" rows={2} defaultValue={qa.actual} />
          </Field>
        </div>
        <Field label="Environment">
          <FInput mono defaultValue={qa.env} leftIcon="server" />
        </Field>
        <Field label="Evidence">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 10px", borderRadius: "var(--radius-sm)", background: "var(--bone-200)", border: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-body)" }}>
              <FIcon name="paperclip" size={13} color="var(--text-muted)" /> {qa.evidence}
            </span>
            <FBtn size="sm" variant="ghost" leftIcon="plus">Lampiran</FBtn>
          </div>
        </Field>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <FBtn leftIcon="bug">File finding</FBtn>
          <FBtn variant="secondary">Batal</FBtn>
        </div>
      </FCard>

      <FCard eyebrow="Alur QA" title="audit → execute" padding={20}>
        <Stepper steps={qa.flow} />
        <div style={{ marginTop: 4, paddingTop: 14, borderTop: "1px solid var(--border-hair)", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Beda dari brief: finding diaudit dulu untuk menemukan akar masalah, baru jadi spec di backlog.
        </div>
      </FCard>
    </div>
  );
}

/* ---------------- hanoman scaffolds the doc index ---------------- */
const F_SCAFFOLD_STATE = {
  done: { icon: "check", bg: "var(--leaf-500)", fg: "#fff", label: null },
  writing: { icon: "loader", bg: "var(--brass-500)", fg: "#fff", label: "menulis…" },
  queued: { icon: null, bg: "transparent", fg: null, label: "antre" },
};

function ScaffoldCat({ c }) {
  const st = F_SCAFFOLD_STATE[c.state];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-hair)", background: c.state === "queued" ? "var(--bone-100)" : "var(--surface-card)" }}>
      <span style={{
        width: 20, height: 20, borderRadius: "50%", flex: "0 0 auto",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: st.bg, border: c.state === "queued" ? "1.5px solid var(--bone-400)" : "none",
        animation: c.state === "writing" ? "hn-pulse 1.4s ease-in-out infinite" : "none",
      }}>
        {st.icon && <FIcon name={st.icon} size={12} stroke={3} color={st.fg} />}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", fontWeight: 500 }}>{c.cat}/</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-subtle)" }}>{c.n} file{st.label ? " · " + st.label : ""}</div>
      </div>
    </div>
  );
}

function ScaffoldDocs({ scaffold }) {
  const pct = Math.round((scaffold.done / scaffold.total) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FCard padding={20}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div>
            <div className="hn-eyebrow" style={{ marginBottom: 6 }}>hanoman · scaffold</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-strong)" }}>
              Scaffold Source of Truth
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>
              membangun seluruh <code>internal/docs</code> · project <span style={{ fontFamily: "var(--font-mono)" }}>{scaffold.project}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: "var(--radius-pill)", background: "var(--brass-100)", color: "var(--brass-700)", fontSize: 12, fontWeight: 600 }}>
              <FIcon name="target" size={12} /> from objective
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: "var(--radius-pill)", background: "var(--bone-200)", color: "var(--text-muted)", fontSize: 12 }}>
              <FIcon name="folder-git-2" size={12} /> from codebase
            </span>
          </div>
        </div>
        <FBar value={pct} showLabel label={`internal/docs · ${scaffold.done}/${scaffold.total} file`} tone="brass" />
      </FCard>

      <FCard eyebrow="Doc index" title="Kategori Source of Truth" padding={20}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {scaffold.cats.map((c) => <ScaffoldCat key={c.cat} c={c} />)}
        </div>
      </FCard>

      <div style={{
        background: "var(--surface-code)", borderRadius: "var(--radius-lg)",
        border: "1px solid var(--term-line)", padding: 16,
        fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.85, color: "var(--term-fg)",
      }}>
        {scaffold.log.map((l, i) => (
          <div key={i}>
            <span style={{ color: l.t === "✓" ? "var(--leaf-500)" : l.t === "$" ? "var(--term-dim)" : "var(--brass-400)", marginRight: 8 }}>{l.t}</span>
            <span style={{ color: l.t === "$" || l.t === " " ? "var(--term-dim)" : "var(--term-fg)" }}>{l.s}</span>
          </div>
        ))}
      </div>

      <FCallout tone="info" title="Index dulu, baru execute">
        Kategori inti harus lengkap sebelum fitur bisa masuk spec → plan → execute. Index inilah Source of Truth-nya.
      </FCallout>
    </div>
  );
}

Object.assign(window, { IdeaFlow, BriefForm, QaForm, ScaffoldDocs });
