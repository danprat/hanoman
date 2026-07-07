/* App.jsx — the interactive Hanoman prototype. Holds navigation +
   mutable data state and wires every action to a real result:
   search filters, "Scan semua", "Brief baru" (creates a spec),
   "Trigger baru" (adds a trigger), trigger switches, run retry/rerun —
   each with toast/modal feedback. */
const H = window.HN;
const HDS = window.HanomanDesignSystem_c639ad;
const { Shell: AShell, ProjectsScreen: AProjects, RunsScreen: ARuns, BacklogScreen: ABacklog,
        DocsWorkspace: ADocs, TriggersScreen: ATriggers, OverviewScreen: AOverview, SettingsScreen: ASettings,
        Modal: AModal, Toast: AToast, Field: AField, HnTextarea: ATextarea, useToast } = window;
const { Button: ABtn, StatusPill: APill, Select: ASelect, Input: AInput, Badge: ABadge, Tabs: ATabs } = HDS;

/* ---------- New backlog item: feature brief OR QA finding ---------- */
const SEVERITY = [
  { value: "critical", label: "Critical" }, { value: "major", label: "Major" }, { value: "minor", label: "Minor" },
];
const PRIORITY = [
  { value: "tinggi", label: "Tinggi" }, { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" },
];

function NewSpecModal({ open, onClose, projects, defaultProject, onCreate }) {
  const blank = {
    kind: "brief", project: defaultProject, title: "",
    // feature brief
    context: "", outcome: "", constraints: "", priority: "sedang",
    // qa finding
    severity: "major", steps: "", expected: "", actual: "", env: "",
  };
  const [f, setF] = React.useState(blank);
  React.useEffect(() => { if (open) setF({ ...blank, project: defaultProject }); }, [open, defaultProject]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const isQa = f.kind === "qa";
  const submit = () => { if (!f.title.trim()) return; onCreate(f); };

  return (
    <AModal open={open} onClose={onClose} icon={isQa ? "bug" : "lightbulb"} eyebrow="human → hanoman"
      title={isQa ? "QA finding baru" : "Feature brief baru"}
      footer={<>
        <ABtn variant="ghost" size="sm" onClick={onClose}>Batal</ABtn>
        <ABtn size="sm" leftIcon={isQa ? "radar" : "messages-square"} onClick={submit}>
          {isQa ? "Filekan finding → audit" : "Buat brief → brainstorm"}
        </ABtn>
      </>}>
      <div style={{ marginBottom: 16 }}>
        <ATabs variant="pill" value={f.kind} onChange={(v) => setF((s) => ({ ...s, kind: v }))} tabs={[
          { value: "brief", label: "Feature brief", icon: "lightbulb" },
          { value: "qa", label: "QA finding", icon: "bug" },
        ]} />
        <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 8, lineHeight: 1.5 }}>
          {isQa
            ? "Finding masuk lewat alur audit → spec → plan → execute. hanoman menelusuri akar masalah dulu."
            : "Brief masuk lewat alur brainstorm → objective → spec → plan → execute."}
        </div>
      </div>

      <AField label="Project">
        <ASelect value={f.project} onChange={set("project")} style={{ width: "100%" }}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      </AField>
      <AField label="Judul">
        <AInput value={f.title} onChange={set("title")}
          placeholder={isQa ? "mis. Funnel double-count sesi lintas tengah malam" : "mis. Jadwal invoice berulang"}
          style={{ width: "100%" }} />
      </AField>

      {isQa ? (
        <>
          <AField label="Severity">
            <ASelect value={f.severity} onChange={set("severity")} style={{ width: "100%" }} options={SEVERITY} />
          </AField>
          <AField label="Langkah reproduksi">
            <ATextarea value={f.steps} onChange={set("steps")} rows={3} mono
              placeholder={"1. Buka …\n2. Lakukan …\n3. Amati …"} />
          </AField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <AField label="Diharapkan">
              <ATextarea value={f.expected} onChange={set("expected")} rows={2} placeholder="Perilaku yang benar…" />
            </AField>
            <AField label="Aktual">
              <ATextarea value={f.actual} onChange={set("actual")} rows={2} placeholder="Perilaku yang terjadi…" />
            </AField>
          </div>
          <AField label="Environment" hint="build / kanal tempat finding muncul">
            <AInput value={f.env} onChange={set("env")} placeholder="prod · web · v0.9.2" style={{ width: "100%" }} />
          </AField>
        </>
      ) : (
        <>
          <AField label="Konteks" hint="Latar belakang & alasan fitur ini dibutuhkan">
            <ATextarea value={f.context} onChange={set("context")} rows={3} placeholder="Situasi & motivasi…" />
          </AField>
          <AField label="Hasil yang diharapkan">
            <ATextarea value={f.outcome} onChange={set("outcome")} rows={2} placeholder="Kondisi setelah selesai…" />
          </AField>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
            <AField label="Batasan" hint="opsional">
              <AInput value={f.constraints} onChange={set("constraints")} placeholder="mis. reuse queue yang ada" style={{ width: "100%" }} />
            </AField>
            <AField label="Prioritas">
              <ASelect value={f.priority} onChange={set("priority")} style={{ width: "100%" }} options={PRIORITY} />
            </AField>
          </div>
        </>
      )}
    </AModal>
  );
}

/* ---------- New trigger ---------- */
const TRG_TYPES = [
  { value: "commit", label: "On commit" }, { value: "schedule", label: "Scheduled" },
  { value: "manual", label: "Manual" }, { value: "interval", label: "Interval" },
];
const TRG_TARGETS = ["plan + execute", "audit", "qa audit", "scaffold docs"];
const TRG_DETAIL_HINT = { commit: "push → main", schedule: "nightly 02:00", manual: "on demand", interval: "setiap 6 jam" };
function NewTriggerModal({ open, onClose, projects, defaultProject, onCreate }) {
  const [f, setF] = React.useState({ project: defaultProject, type: "commit", detail: "", target: "plan + execute" });
  React.useEffect(() => { if (open) setF({ project: defaultProject, type: "commit", detail: "", target: "plan + execute" }); }, [open, defaultProject]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = () => onCreate({ ...f, detail: f.detail.trim() || TRG_DETAIL_HINT[f.type] });
  return (
    <AModal open={open} onClose={onClose} icon="zap" eyebrow="automation" title="Trigger baru"
      footer={<>
        <ABtn variant="ghost" size="sm" onClick={onClose}>Batal</ABtn>
        <ABtn size="sm" leftIcon="plus" onClick={submit}>Tambah trigger</ABtn>
      </>}>
      <AField label="Project">
        <ASelect value={f.project} onChange={set("project")} style={{ width: "100%" }}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      </AField>
      <AField label="Tipe pemicu">
        <ASelect value={f.type} onChange={set("type")} style={{ width: "100%" }} options={TRG_TYPES} />
      </AField>
      <AField label="Detail" hint={"mis. " + TRG_DETAIL_HINT[f.type]}>
        <AInput value={f.detail} onChange={set("detail")} placeholder={TRG_DETAIL_HINT[f.type]} style={{ width: "100%" }} />
      </AField>
      <AField label="Jalankan">
        <ASelect value={f.target} onChange={set("target")} style={{ width: "100%" }}
          options={TRG_TARGETS.map((t) => ({ value: t, label: t }))} />
      </AField>
    </AModal>
  );
}

/* ---------- New project ---------- */
function NewProjectModal({ open, onClose, onCreate }) {
  const blank = { kind: "from-scratch", name: "", desc: "", dir: "", objective: "" };
  const [f, setF] = React.useState(blank);
  React.useEffect(() => { if (open) setF(blank); }, [open]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const scratch = f.kind === "from-scratch";
  const canSubmit = scratch ? !!f.name.trim() : !!f.dir.trim();
  const submit = () => { if (!canSubmit) return; onCreate(f); };
  const browse = () => setF((s) => ({ ...s, dir: "~/code/" + (s.name.trim() || "repo"), name: s.name || (s.name = "") || s.name }));
  return (
    <AModal open={open} onClose={onClose} icon="box" eyebrow="workspace" title="Project baru"
      footer={<>
        <ABtn variant="ghost" size="sm" onClick={onClose}>Batal</ABtn>
        <ABtn size="sm" leftIcon={scratch ? "messages-square" : "radar"} onClick={submit}>
          {scratch ? "Buat → brainstorm objective" : "Tambah → reverse-engineer docs"}
        </ABtn>
      </>}>
      <div style={{ marginBottom: 16 }}>
        <ATabs variant="pill" value={f.kind} onChange={(v) => setF((s) => ({ ...s, kind: v }))} tabs={[
          { value: "from-scratch", label: "From scratch", icon: "sparkles" },
          { value: "existing", label: "Existing codebase", icon: "folder-git-2" },
        ]} />
        <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 8, lineHeight: 1.5 }}>
          {scratch
            ? "hanoman brainstorm sampai MVP objective terkunci, lalu scaffold seluruh doc index sebagai Source of Truth."
            : "hanoman reverse-engineer docs dari codebase yang ada, lalu menyusun Source of Truth-nya."}
        </div>
      </div>

      {scratch ? (
        <>
          <AField label="Nama project" hint="lowercase, tanpa spasi">
            <AInput value={f.name} onChange={set("name")} placeholder="mis. kirana" style={{ width: "100%" }} />
          </AField>
          <AField label="Deskripsi">
            <AInput value={f.desc} onChange={set("desc")} placeholder="mis. Marketplace jasa lokal" style={{ width: "100%" }} />
          </AField>
          <AField label="Ide awal" hint="opsional — bahan brainstorm objective">
            <ATextarea value={f.objective} onChange={set("objective")} rows={2} placeholder="Tuang ide di sini…" />
          </AField>
        </>
      ) : (
        <>
          <AField label="Direktori" hint="pilih folder codebase yang akan dipantau">
            <div style={{ display: "flex", gap: 8 }}>
              <AInput value={f.dir} onChange={set("dir")} leftIcon="folder" placeholder="~/code/nama-repo" style={{ flex: 1 }} />
              <ABtn size="sm" variant="secondary" leftIcon="folder-open" onClick={browse}>Pilih folder</ABtn>
            </div>
          </AField>
          <AField label="Deskripsi" hint="opsional">
            <AInput value={f.desc} onChange={set("desc")} placeholder="mis. POS ritel + inventori" style={{ width: "100%" }} />
          </AField>
        </>
      )}
    </AModal>
  );
}

const ADV_STAGES = ["brainstorming", "objective", "spec-ready", "planned", "executing", "done"];
const ADV_TOAST = {
  objective: "objective terkunci", "spec-ready": "spec ditulis", planned: "plan dibuat",
  executing: "execute dimulai", done: "selesai — docs tersinkron",
};

function App() {
  const [section, setSection] = React.useState("overview");
  const [projects, setProjects] = React.useState(H.projects);
  const [projectId, setProjectId] = React.useState(H.docsProject);
  const [search, setSearch] = React.useState("");
  const [scanning, setScanning] = React.useState(false);
  const [backlog, setBacklog] = React.useState(H.backlog);
  const [triggers, setTriggers] = React.useState(H.triggers);
  const [modal, setModal] = React.useState(null); // "brief" | "trigger" | "project" | null
  const [toast, showToast] = useToast();

  const proj = projects.find((p) => p.id === projectId) || projects[0];
  const q = search.trim().toLowerCase();
  const shownProjects = q
    ? projects.filter((p) => (p.name + " " + p.desc + " " + p.stack).toLowerCase().includes(q))
    : projects;

  function openProject(p) { setProjectId(p.id); setSection("docs"); }

  function scanAll() {
    if (scanning) return;
    setScanning(true);
    showToast("Memindai " + projects.length + " project · menyinkron index…", "info", "radar");
    setTimeout(() => { setScanning(false); showToast("Scan selesai · Source of Truth tersinkron", "ok", "check-circle-2"); }, 1600);
  }

  function createProject(f) {
    const scratch = f.kind === "from-scratch";
    const rawName = scratch ? f.name : (f.name || (f.dir.split("/").filter(Boolean).pop() || "repo"));
    const id = rawName.trim().toLowerCase().replace(/\s+/g, "-");
    const p = {
      id, name: id, desc: f.desc.trim() || (scratch ? "project baru" : "codebase existing"),
      kind: f.kind, stack: scratch ? "" : (f.dir || ""),
      docStatus: "broken", coverage: 0,
      run: scratch ? { status: "idle", phase: null, kind: null } : { status: "queued", phase: "Reverse-engineer", kind: "scaffold" },
      backlog: 0, topStage: scratch ? "brainstorm" : "spec", triggers: ["manual"],
      activity: scratch ? "dibuat · baru saja" : "antre reverse-engineer docs · baru saja",
      commit: "belum ada commit",
    };
    setProjects((list) => [p, ...list]);
    setProjectId(id); setModal(null); setSection("docs");
    showToast("Project " + id + " dibuat · " + (scratch ? "mulai brainstorm objective" : "reverse-engineer docs"), "ok", "box");
  }

  function advanceSpec(spec) {
    const i = ADV_STAGES.indexOf(spec.stage);
    if (i < 0 || i >= ADV_STAGES.length - 1) return;
    const next = ADV_STAGES[i + 1];
    setBacklog((b) => b.map((s) => s.id === spec.id ? { ...s, stage: next } : s));
    showToast(spec.id + " · " + (ADV_TOAST[next] || next), next === "done" ? "ok" : "info",
      next === "executing" ? "play" : next === "done" ? "check-circle-2" : "arrow-right");
    if (next === "executing") setSection("runs");
  }

  function deleteSpec(spec) {
    setBacklog((b) => b.filter((s) => s.id !== spec.id));
    showToast(spec.id + " dihapus dari backlog", "warn", "trash-2");
  }

  function createSpec(f) {
    const nums = backlog.map((s) => parseInt((s.id.match(/\d+/) || [140])[0], 10));
    const id = "SPEC-" + (Math.max(140, ...nums) + 1);
    const isQa = f.kind === "qa";
    const priority = isQa
      ? (f.severity === "minor" ? "sedang" : "tinggi")
      : f.priority;
    const objective = isQa
      ? (f.actual.trim() || f.steps.trim() || "— audit untuk menelusuri akar masalah.")
      : (f.outcome.trim() || f.context.trim() || "— brainstorm untuk memperjelas objective.");
    const spec = {
      id, project: f.project, title: f.title.trim(),
      source: isQa ? "qa" : "brief", stage: "brainstorming",
      author: isQa ? ("QA · " + H.owner.name) : H.owner.name,
      priority, objective,
    };
    setBacklog((b) => [spec, ...b]);
    setModal(null); setSection("backlog");
    showToast(id + (isQa ? " difilekan · masuk audit" : " dibuat · masuk brainstorm"), "ok", isQa ? "bug" : "lightbulb");
  }

  function createTrigger(f) {
    const id = "t" + (Date.now() % 100000);
    setTriggers((t) => [{ id, project: f.project, type: f.type, detail: f.detail, target: f.target, enabled: true }, ...t]);
    setModal(null); setSection("triggers");
    showToast("Trigger ditambahkan · " + f.project + " · " + f.type, "ok", "zap");
  }

  function toggleTrigger(id) {
    setTriggers((list) => list.map((t) => {
      if (t.id !== id) return t;
      showToast("Trigger " + t.project + " · " + t.type + (t.enabled ? " dinonaktifkan" : " diaktifkan"),
        t.enabled ? "warn" : "ok", "zap");
      return { ...t, enabled: !t.enabled };
    }));
  }

  let screen = null;
  if (section === "overview") {
    screen = (
      <AShell active="overview" title="Overview" breadcrumb="nafanesia.id · ringkasan workspace"
        onNavigate={setSection}
        actions={<ABtn size="sm" leftIcon={scanning ? "loader" : "radar"} onClick={scanAll}>{scanning ? "Memindai…" : "Scan semua"}</ABtn>}>
        <AOverview projects={projects} runs={H.runs} backlog={backlog} triggers={triggers}
          onOpenProject={openProject} onGoto={setSection} />
      </AShell>
    );
  } else if (section === "projects") {
    screen = (
      <AShell active="projects" title="Projects" breadcrumb="nafanesia.id · workspace"
        showSearch searchValue={search} onSearchChange={setSearch} onNavigate={setSection}
        actions={<>
          <ABtn size="sm" variant="secondary" leftIcon={scanning ? "loader" : "radar"} onClick={scanAll}>{scanning ? "Memindai…" : "Scan semua"}</ABtn>
          <ABtn size="sm" leftIcon="plus" onClick={() => setModal("project")}>Project baru</ABtn>
        </>}>
        {shownProjects.length === 0
          ? <div style={{ padding: "60px 0", textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-sans)" }}>
              Tidak ada project cocok dengan “{search}”.
            </div>
          : <AProjects projects={shownProjects} runs={H.runs} variant="list" onOpen={openProject} pageSize={5} />}
      </AShell>
    );
  } else if (section === "backlog") {
    screen = (
      <AShell active="backlog" title="Backlog" breadcrumb="specs · brainstorm → execute"
        onNavigate={setSection}
        actions={<ABtn size="sm" leftIcon="plus" onClick={() => setModal("brief")}>Tambah</ABtn>}>
        <ABacklog backlog={backlog} projects={projects} pageSize={4}
          onAdvance={advanceSpec} onDelete={deleteSpec} onOpenRun={() => setSection("runs")} />
      </AShell>
    );
  } else if (section === "runs") {
    screen = (
      <AShell active="runs" title="Runs" breadcrumb="Claude Code · live activity"
        onNavigate={setSection}
        actions={<APill status="running" size="sm">2 aktif</APill>}>
        <ARuns runs={H.runs} selectedId="RUN-8842" pageSize={4} />
      </AShell>
    );
  } else if (section === "docs") {
    screen = (
      <AShell active="docs" title="Source of Truth" breadcrumb={"internal/docs · " + proj.name}
        onNavigate={setSection} wide
        actions={<ASelect size="sm" value={proj.id}
          onChange={(e) => setProjectId(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />}>
        <ADocs projectName={proj.name} docTree={H.docTree} coverage={proj.coverage} docStatus={proj.docStatus} />
      </AShell>
    );
  } else if (section === "triggers") {
    screen = (
      <AShell active="triggers" title="Triggers" breadcrumb="automation · plan + execute"
        onNavigate={setSection}
        actions={<ABtn size="sm" leftIcon="plus" onClick={() => setModal("trigger")}>Trigger baru</ABtn>}>
        <ATriggers triggers={triggers} onToggle={toggleTrigger} onNew={() => setModal("trigger")} pageSize={5} />
      </AShell>
    );
  } else if (section === "settings") {
    screen = (
      <AShell active="settings" title="Settings" breadcrumb="nafanesia.id · workspace"
        onNavigate={setSection}>
        <ASettings onToast={showToast} />
      </AShell>
    );
  }

  return (
    <>
      {screen}
      <NewSpecModal open={modal === "brief"} onClose={() => setModal(null)}
        projects={projects} defaultProject={proj.id} onCreate={createSpec} />
      <NewTriggerModal open={modal === "trigger"} onClose={() => setModal(null)}
        projects={projects} defaultProject={proj.id} onCreate={createTrigger} />
      <NewProjectModal open={modal === "project"} onClose={() => setModal(null)} onCreate={createProject} />
      <AToast toast={toast} />
    </>
  );
}

Object.assign(window, { App });
