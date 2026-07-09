/* App.tsx — navigation + state, wired to the API. Ported from the
   prototype App.jsx: window.HN → api.* on mount; every mutating handler
   calls the client and updates state from the response. */
import React from "react";
import { Shell, Modal, Field, HnTextarea, Button, StatusPill, Select, Input, Tabs, Toast, useToast, Icon, StateBlock } from "./ds";
import { api, ApiError } from "./api/client";
import { isRunActive } from "@hanoman/shared";
import type { ProjectView, Spec, Trigger, Run } from "@hanoman/shared";
import type { ProjectVM, RunVM } from "./screens/types";
import { OverviewScreen } from "./screens/OverviewScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { BacklogScreen } from "./screens/BacklogScreen";
import { RunsScreen } from "./screens/RunsScreen";
import { TerminalScreen } from "./screens/TerminalScreen";
import { DocsWorkspace } from "./screens/DocsWorkspace";
import { TriggersScreen } from "./screens/TriggersScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

const OWNER = "Rangga";
const SEVERITY = [{ value: "critical", label: "Critical" }, { value: "major", label: "Major" }, { value: "minor", label: "Minor" }];
const PRIORITY = [{ value: "tinggi", label: "Tinggi" }, { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" }];

type SpecForm = { kind: string; project: string; title: string; context: string; outcome: string; constraints: string;
  priority: string; severity: string; steps: string; expected: string; actual: string; env: string };

function NewSpecModal({ open, onClose, projects, defaultProject, onCreate }:
  { open: boolean; onClose: () => void; projects: ProjectVM[]; defaultProject: string; onCreate: (f: SpecForm) => void }) {
  const blank: SpecForm = { kind: "brief", project: defaultProject, title: "", context: "", outcome: "", constraints: "",
    priority: "sedang", severity: "major", steps: "", expected: "", actual: "", env: "" };
  const [f, setF] = React.useState<SpecForm>(blank);
  React.useEffect(() => { if (open) setF({ ...blank, project: defaultProject }); }, [open, defaultProject]);
  const set = (k: keyof SpecForm) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const isQa = f.kind === "qa";
  const submit = () => { if (!f.title.trim()) return; onCreate(f); };
  return (
    <Modal open={open} onClose={onClose} icon={isQa ? "bug" : "lightbulb"} eyebrow="human → hanoman"
      title={isQa ? "QA finding baru" : "Feature brief baru"}
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon={isQa ? "radar" : "messages-square"} onClick={submit}>
          {isQa ? "Filekan finding → audit" : "Buat brief → brainstorm"}
        </Button>
      </>}>
      <div style={{ marginBottom: 16 }}>
        <Tabs variant="pill" value={f.kind} onChange={(v) => setF((s) => ({ ...s, kind: v }))} tabs={[
          { value: "brief", label: "Feature brief", icon: "lightbulb" },
          { value: "qa", label: "QA finding", icon: "bug" },
        ]} />
        <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 8, lineHeight: 1.5 }}>
          {isQa ? "Finding masuk lewat alur audit → spec → plan → execute. hanoman menelusuri akar masalah dulu."
            : "Brief masuk lewat alur brainstorm → objective → spec → plan → execute."}
        </div>
      </div>
      <Field label="Project">
        <Select value={f.project} onChange={set("project")} style={{ width: "100%" }}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <Field label="Judul">
        <Input value={f.title} onChange={set("title")}
          placeholder={isQa ? "mis. Funnel double-count sesi lintas tengah malam" : "mis. Jadwal invoice berulang"}
          style={{ width: "100%" }} />
      </Field>
      {isQa ? (
        <>
          <Field label="Severity">
            <Select value={f.severity} onChange={set("severity")} style={{ width: "100%" }} options={SEVERITY} />
          </Field>
          <Field label="Langkah reproduksi">
            <HnTextarea value={f.steps} onChange={set("steps")} rows={3} mono placeholder={"1. Buka …\n2. Lakukan …\n3. Amati …"} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Diharapkan"><HnTextarea value={f.expected} onChange={set("expected")} rows={2} placeholder="Perilaku yang benar…" /></Field>
            <Field label="Aktual"><HnTextarea value={f.actual} onChange={set("actual")} rows={2} placeholder="Perilaku yang terjadi…" /></Field>
          </div>
          <Field label="Environment" hint="build / kanal tempat finding muncul">
            <Input value={f.env} onChange={set("env")} placeholder="prod · web · v0.9.2" style={{ width: "100%" }} />
          </Field>
        </>
      ) : (
        <>
          <Field label="Konteks" hint="Latar belakang & alasan fitur ini dibutuhkan">
            <HnTextarea value={f.context} onChange={set("context")} rows={3} placeholder="Situasi & motivasi…" />
          </Field>
          <Field label="Hasil yang diharapkan">
            <HnTextarea value={f.outcome} onChange={set("outcome")} rows={2} placeholder="Kondisi setelah selesai…" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
            <Field label="Batasan" hint="opsional">
              <Input value={f.constraints} onChange={set("constraints")} placeholder="mis. reuse queue yang ada" style={{ width: "100%" }} />
            </Field>
            <Field label="Prioritas">
              <Select value={f.priority} onChange={set("priority")} style={{ width: "100%" }} options={PRIORITY} />
            </Field>
          </div>
        </>
      )}
    </Modal>
  );
}

const TRG_TYPES = [{ value: "commit", label: "On commit" }, { value: "schedule", label: "Scheduled" },
  { value: "manual", label: "Manual" }, { value: "interval", label: "Interval" }];
const TRG_TARGETS = ["plan + execute", "audit", "qa audit", "scaffold docs"];
const TRG_DETAIL_HINT: Record<string, string> = { commit: "push → main", schedule: "nightly 02:00", manual: "on demand", interval: "setiap 6 jam" };
type TriggerForm = { project: string; type: string; detail: string; target: string };

function NewTriggerModal({ open, onClose, projects, defaultProject, onCreate }:
  { open: boolean; onClose: () => void; projects: ProjectVM[]; defaultProject: string; onCreate: (f: TriggerForm) => void }) {
  const [f, setF] = React.useState<TriggerForm>({ project: defaultProject, type: "commit", detail: "", target: "plan + execute" });
  React.useEffect(() => { if (open) setF({ project: defaultProject, type: "commit", detail: "", target: "plan + execute" }); }, [open, defaultProject]);
  const set = (k: keyof TriggerForm) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = () => onCreate({ ...f, detail: f.detail.trim() || TRG_DETAIL_HINT[f.type]! });
  return (
    <Modal open={open} onClose={onClose} icon="zap" eyebrow="automation" title="Trigger baru"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="plus" onClick={submit}>Tambah trigger</Button>
      </>}>
      <Field label="Project">
        <Select value={f.project} onChange={set("project")} style={{ width: "100%" }}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <Field label="Tipe pemicu">
        <Select value={f.type} onChange={set("type")} style={{ width: "100%" }} options={TRG_TYPES} />
      </Field>
      <Field label="Detail" hint={"mis. " + TRG_DETAIL_HINT[f.type]}>
        <Input value={f.detail} onChange={set("detail")} placeholder={TRG_DETAIL_HINT[f.type]} style={{ width: "100%" }} />
      </Field>
      <Field label="Jalankan">
        <Select value={f.target} onChange={set("target")} style={{ width: "100%" }}
          options={TRG_TARGETS.map((t) => ({ value: t, label: t }))} />
      </Field>
    </Modal>
  );
}

type FsEntry = { name: string; path: string };
function FolderRow({ icon, name, onClick }: { icon: string; name: string; onClick: () => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer",
        borderBottom: "1px solid var(--border-hair)", background: hover ? "var(--bone-100)" : "transparent",
        fontSize: 13, color: "var(--text-strong)" }}>
      <Icon name={icon} size={16} color="var(--brass-700)" />
      <span style={{ fontFamily: "var(--font-mono)" }}>{name}</span>
    </div>
  );
}

// Real device folder picker: navigates the server's filesystem (same machine)
// and returns an absolute path — replaces the old mock that faked "~/code/…".
function FolderPicker({ open, onClose, onPick, start }:
  { open: boolean; onClose: () => void; onPick: (path: string) => void; start?: string }) {
  const [cur, setCur] = React.useState("");
  const [parent, setParent] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<FsEntry[]>([]);
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const load = React.useCallback((path?: string) => {
    setLoading(true); setErr("");
    api.browseFs(path)
      .then((r) => { setCur(r.path); setParent(r.parent); setEntries(r.entries); })
      .catch(() => setErr("Tak bisa membuka folder ini"))
      .finally(() => setLoading(false));
  }, []);
  React.useEffect(() => { if (open) load(start && start.trim() ? start.trim() : undefined); }, [open, start, load]);
  return (
    <Modal open={open} onClose={onClose} icon="folder-open" eyebrow="device" title="Pilih folder codebase"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" disabled={!cur} onClick={() => { onPick(cur); onClose(); }}>Pilih folder ini</Button>
      </>}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Input value={cur} onChange={(e: any) => setCur(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === "Enter") load(e.currentTarget.value); }}
          leftIcon="folder" mono style={{ flex: 1 }} placeholder="/path/ke/folder" />
        <Button size="sm" variant="secondary" onClick={() => load(cur)}>Buka</Button>
      </div>
      <div style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", maxHeight: 320, overflow: "auto" }}>
        {loading ? <StateBlock kind="loading" compact title="Membuka folder…" />
          : err ? <StateBlock kind="error" compact title={err} hint={cur} action={() => load(cur)} />
          : <>
              {parent && <FolderRow icon="corner-left-up" name=".." onClick={() => load(parent)} />}
              {entries.map((e) => <FolderRow key={e.path} icon="folder" name={e.name} onClick={() => load(e.path)} />)}
              {entries.length === 0 && <StateBlock kind="empty" compact icon="folder"
                title="Tak ada sub-folder" hint="Folder ini bisa langsung dipilih." />}
            </>}
      </div>
    </Modal>
  );
}

type ProjectForm = { kind: string; name: string; desc: string; dir: string; objective: string };
function NewProjectModal({ open, onClose, onCreate }:
  { open: boolean; onClose: () => void; onCreate: (f: ProjectForm) => void }) {
  const blank: ProjectForm = { kind: "from-scratch", name: "", desc: "", dir: "", objective: "" };
  const [f, setF] = React.useState<ProjectForm>(blank);
  React.useEffect(() => { if (open) setF(blank); }, [open]);
  const set = (k: keyof ProjectForm) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const scratch = f.kind === "from-scratch";
  const canSubmit = scratch ? !!f.name.trim() : !!f.dir.trim();
  const submit = () => { if (!canSubmit) return; onCreate(f); };
  const [picker, setPicker] = React.useState(false);
  return (
    <Modal open={open} onClose={onClose} icon="box" eyebrow="workspace" title="Project baru"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon={scratch ? "messages-square" : "radar"} onClick={submit}>
          {scratch ? "Buat → brainstorm objective" : "Tambah → reverse-engineer docs"}
        </Button>
      </>}>
      <div style={{ marginBottom: 16 }}>
        <Tabs variant="pill" value={f.kind} onChange={(v) => setF((s) => ({ ...s, kind: v }))} tabs={[
          { value: "from-scratch", label: "From scratch", icon: "sparkles" },
          { value: "existing", label: "Existing codebase", icon: "folder-git-2" },
        ]} />
        <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 8, lineHeight: 1.5 }}>
          {scratch ? "hanoman brainstorm sampai MVP objective terkunci, lalu scaffold seluruh doc index sebagai Source of Truth."
            : "hanoman reverse-engineer docs dari codebase yang ada, lalu menyusun Source of Truth-nya."}
        </div>
      </div>
      {scratch ? (
        <>
          <Field label="Nama project" hint="lowercase, tanpa spasi">
            <Input value={f.name} onChange={set("name")} placeholder="mis. kirana" style={{ width: "100%" }} />
          </Field>
          <Field label="Deskripsi">
            <Input value={f.desc} onChange={set("desc")} placeholder="mis. Marketplace jasa lokal" style={{ width: "100%" }} />
          </Field>
          <Field label="Ide awal" hint="opsional — bahan brainstorm objective">
            <HnTextarea value={f.objective} onChange={set("objective")} rows={2} placeholder="Tuang ide di sini…" />
          </Field>
        </>
      ) : (
        <>
          <Field label="Direktori" hint="pilih folder codebase yang akan dipantau">
            <div style={{ display: "flex", gap: 8 }}>
              <Input value={f.dir} onChange={set("dir")} leftIcon="folder" mono placeholder="/path/ke/repo" style={{ flex: 1 }} />
              <Button size="sm" variant="secondary" leftIcon="folder-open" onClick={() => setPicker(true)}>Pilih folder</Button>
            </div>
          </Field>
          <FolderPicker open={picker} onClose={() => setPicker(false)}
            start={f.dir} onPick={(p) => setF((s) => ({ ...s, dir: p }))} />
          <Field label="Deskripsi" hint="opsional">
            <Input value={f.desc} onChange={set("desc")} placeholder="mis. POS ritel + inventori" style={{ width: "100%" }} />
          </Field>
        </>
      )}
    </Modal>
  );
}

export default function App() {
  const [section, setSection] = React.useState("overview");
  const [projects, setProjects] = React.useState<ProjectView[]>([]);
  const [backlog, setBacklog] = React.useState<Spec[]>([]);
  const [runs, setRuns] = React.useState<Run[]>([]);
  const [triggers, setTriggers] = React.useState<Trigger[]>([]);
  const [projectId, setProjectId] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [scanning, setScanning] = React.useState(false);
  const [modal, setModal] = React.useState<string | null>(null);
  const [toast, showToast] = useToast();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");

  const load = React.useCallback(() => {
    setStatus("loading");
    Promise.all([api.listProjects(), api.listSpecs(), api.listRuns(), api.listTriggers()])
      .then(([p, s, r, t]) => {
        setProjects(p); setBacklog(s); setRuns(r); setTriggers(t);
        setProjectId((cur) => cur || p[0]?.id || "");
        setStatus("ready");
      })
      .catch(() => {
        setStatus("error");
        showToast("Gagal memuat data dari server", "err", "x-circle");
      });
  }, [showToast]);
  React.useEffect(() => { load(); }, [load]);

  // view models: enrich API entities with the fields the screens expect
  const projectsView: ProjectVM[] = React.useMemo(() => projects.map((p) => ({
    ...p, triggers: [...new Set(triggers.filter((t) => t.projectId === p.id).map((t) => t.type))],
  })), [projects, triggers]);
  const runsView: RunVM[] = React.useMemo(() => {
    const byId = new Map(backlog.map((s) => [s.id, s]));
    return runs.map((r) => {
      const activePhase = (r.phases as { name: string; state: string }[]).find((f) => f.state === "active")?.name ?? null;
      const spec = r.specId ? byId.get(r.specId) : null;
      const title = spec?.title ?? (r.kind === "scaffold" ? "Scaffold docs dari MVP objective" : r.id);
      return { ...r, project: r.projectId, spec: r.specId, title, phase: activePhase };
    });
  }, [runs, backlog]);

  const activeRunSpecs = React.useMemo(
    () => new Set(runs.filter((r) => r.specId && isRunActive(r.status))
      .map((r) => r.specId as string)),
    [runs]);

  // Stage bar is a live mirror: while any run is active, re-poll specs+runs so the
  // board reflects real phase progress. Stops when nothing is running.
  const anyRunActive = runs.some((r) => isRunActive(r.status));
  React.useEffect(() => {
    if (!anyRunActive) return;
    const t = setInterval(() => {
      Promise.all([api.listSpecs(), api.listRuns()])
        .then(([s, r]) => { setBacklog(s); setRuns(r); })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [anyRunActive]);

  const proj = projectsView.find((p) => p.id === projectId) || projectsView[0];
  const q = search.trim().toLowerCase();
  const shownProjects = q
    ? projectsView.filter((p) => (p.name + " " + p.desc + " " + p.stack).toLowerCase().includes(q))
    : projectsView;

  function openProject(p: ProjectVM) { setProjectId(p.id); setSection("docs"); }

  async function scanAll() {
    if (scanning) return;
    setScanning(true);
    showToast("Memindai " + projects.length + " project · menyinkron index…", "info", "radar");
    try { await Promise.all(projects.map((p) => api.scanProject(p.id))); setProjects(await api.listProjects()); }
    catch { /* ignore */ }
    setScanning(false);
    showToast("Scan selesai · Source of Truth tersinkron", "ok", "check-circle-2");
  }

  async function createProject(f: ProjectForm) {
    const scratch = f.kind === "from-scratch";
    const name = f.name.trim() || (f.dir.split("/").filter(Boolean).pop() || "repo");
    try {
      const created = await api.createProject({ name, kind: f.kind, repoDir: scratch ? undefined : f.dir, desc: f.desc.trim() });
      setProjects((list) => [created, ...list]);
      setProjectId(created.id); setModal(null); setSection("docs");
      showToast("Project " + created.id + " dibuat · " + (scratch ? "mulai brainstorm objective" : "reverse-engineer docs"), "ok", "box");
    } catch { showToast("Gagal membuat project", "err", "x-circle"); }
  }

  // Cascade di DB ikut menghapus spec/run/trigger project ini — cermin state lokalnya.
  async function deleteProject(p: ProjectVM) {
    if (!window.confirm(`Hapus project "${p.name}"? Semua spec, run, dan trigger-nya ikut terhapus.`)) return;
    try {
      await api.deleteProject(p.id);
      setProjects((list) => list.filter((x) => x.id !== p.id));
      setBacklog((b) => b.filter((s) => s.projectId !== p.id));
      setRuns((r) => r.filter((x) => x.projectId !== p.id));
      setTriggers((t) => t.filter((x) => x.projectId !== p.id));
      setProjectId((cur) => (cur === p.id ? "" : cur));
      if (section === "docs") setSection("projects");
      showToast("Project " + p.id + " dihapus", "warn", "trash-2");
    } catch (e) {
      const busy = e instanceof ApiError && e.status === 409;
      showToast("Gagal hapus " + p.id + (busy ? " · masih ada run aktif" : ""), "err", "x-circle");
    }
  }

  async function deleteRun(run: RunVM) {
    try {
      await api.deleteRun(run.id);
      setRuns((list) => list.filter((r) => r.id !== run.id));
      showToast("Run " + run.id + " dihapus", "warn", "trash-2");
    } catch (e) {
      const busy = e instanceof ApiError && e.status === 409;
      showToast("Gagal hapus " + run.id + (busy ? " · run masih aktif" : ""), "err", "x-circle");
    }
  }

  async function startRun(spec: Spec) {
    try {
      const { runId } = await api.startRun({
        project: spec.projectId,
        flow: spec.source === "qa" ? "qa" : "feature",
        specId: spec.id,
      });
      setRuns(await api.listRuns());
      showToast(spec.id + " · run " + runId + " dimulai", "info", "play");
      setSection("runs");
    } catch (e) {
      const budget = e instanceof ApiError && e.status === 409;
      showToast(spec.id + " · gagal mulai run" + (budget ? " · budget harian tercapai" : ""), "warn", "x-circle");
    }
  }

  async function deleteSpec(spec: Spec) {
    await api.deleteSpec(spec.id);
    setBacklog((b) => b.filter((s) => s.id !== spec.id));
    showToast(spec.id + " dihapus dari backlog", "warn", "trash-2");
  }

  async function createSpec(f: SpecForm) {
    const isQa = f.kind === "qa";
    const payload = isQa
      ? { severity: f.severity, steps: f.steps, expected: f.expected, actual: f.actual, env: f.env }
      : { context: f.context, outcome: f.outcome, constraints: f.constraints, priority: f.priority };
    try {
      const created = await api.createSpec({ project: f.project, source: f.kind, title: f.title.trim(), priority: f.priority, payload });
      setBacklog((b) => [created, ...b]);
      setModal(null); setSection("backlog");
      showToast(created.id + (isQa ? " difilekan · masuk audit" : " dibuat · masuk brainstorm"), "ok", isQa ? "bug" : "lightbulb");
    } catch { showToast("Gagal membuat spec", "err", "x-circle"); }
  }

  async function createTrigger(f: TriggerForm) {
    try {
      const created = await api.createTrigger({ project: f.project, type: f.type, detail: f.detail, target: f.target });
      setTriggers((t) => [created, ...t]);
      setModal(null); setSection("triggers");
      showToast("Trigger ditambahkan · " + f.project + " · " + f.type, "ok", "zap");
    } catch { showToast("Gagal menambah trigger", "err", "x-circle"); }
  }

  async function toggleTrigger(id: string) {
    const prev = triggers.find((t) => t.id === id);
    const updated = await api.toggleTrigger(id);
    setTriggers((list) => list.map((t) => t.id === id ? updated : t));
    showToast("Trigger " + updated.projectId + " · " + updated.type + (updated.enabled ? " diaktifkan" : " dinonaktifkan"),
      prev && prev.enabled ? "warn" : "ok", "zap");
  }

  async function deleteTrigger(t: Trigger) {
    if (!window.confirm(`Hapus trigger ${t.type} untuk "${t.projectId}"?`)) return;
    try {
      await api.deleteTrigger(t.id);
      setTriggers((list) => list.filter((x) => x.id !== t.id));
      showToast("Trigger " + t.projectId + " · " + t.type + " dihapus", "warn", "trash-2");
    } catch { showToast("Gagal hapus trigger", "err", "x-circle"); }
  }

  // Fetch awal dipakai semua screen kecuali Settings, jadi loading/error-nya
  // digerbangkan satu kali di sini.
  const gate = (body: React.ReactNode) =>
    status === "loading" ? <StateBlock kind="loading" title="Memuat workspace…" />
      : status === "error" ? <StateBlock kind="error" title="Gagal memuat data dari server"
          hint="Pastikan server hanoman berjalan, lalu coba lagi." action={load} />
      : body;

  let screen: React.ReactNode = null;
  if (section === "overview") {
    screen = (
      <Shell active="overview" title="Overview" breadcrumb="nafanesia.id · ringkasan workspace" onNavigate={setSection}
        actions={<Button size="sm" leftIcon={scanning ? "loader" : "radar"} onClick={scanAll}>{scanning ? "Memindai…" : "Scan semua"}</Button>}>
        {gate(<OverviewScreen projects={projectsView} runs={runsView} backlog={backlog} triggers={triggers}
          onOpenProject={openProject} onGoto={setSection} />)}
      </Shell>
    );
  } else if (section === "projects") {
    screen = (
      <Shell active="projects" title="Projects" breadcrumb="nafanesia.id · workspace"
        showSearch searchValue={search} onSearchChange={setSearch} onNavigate={setSection}
        actions={<>
          <Button size="sm" variant="secondary" leftIcon={scanning ? "loader" : "radar"} onClick={scanAll}>{scanning ? "Memindai…" : "Scan semua"}</Button>
          <Button size="sm" leftIcon="plus" onClick={() => setModal("project")}>Project baru</Button>
        </>}>
        {gate(
          projectsView.length === 0
            ? <StateBlock kind="empty" icon="box" title="Belum ada project"
                hint="Mulai dari nol atau tambahkan codebase yang sudah ada — hanoman menyusun Source of Truth-nya."
                action={() => setModal("project")} actionLabel="Project baru" />
            : shownProjects.length === 0
              ? <StateBlock kind="empty" icon="search" title={`Tidak ada project cocok dengan “${search}”`}
                  hint="Coba kata kunci lain, atau kosongkan pencarian."
                  action={() => setSearch("")} actionLabel="Hapus pencarian" actionIcon="x" />
              : <ProjectsScreen projects={shownProjects} runs={runsView} variant="list" onOpen={openProject} onDelete={deleteProject} pageSize={5} />)}
      </Shell>
    );
  } else if (section === "backlog") {
    screen = (
      <Shell active="backlog" title="Backlog" breadcrumb="specs · brainstorm → execute" onNavigate={setSection}
        actions={<Button size="sm" leftIcon="plus" onClick={() => setModal("brief")}>Tambah</Button>}>
        {gate(<BacklogScreen backlog={backlog} projects={projectsView} pageSize={4}
          onStart={startRun} activeRunSpecs={activeRunSpecs} onNew={() => setModal("brief")}
          onDelete={deleteSpec} onOpenRun={() => setSection("runs")} />)}
      </Shell>
    );
  } else if (section === "runs") {
    screen = (
      <Shell active="runs" title="Runs" breadcrumb="Claude Code · live activity" onNavigate={setSection}
        actions={<StatusPill status="running" size="sm">{runsView.filter((r) => r.status === "running").length} aktif</StatusPill>}>
        {gate(<RunsScreen runs={runsView} pageSize={4} onDelete={deleteRun} onGotoBacklog={() => setSection("backlog")} />)}
      </Shell>
    );
  } else if (section === "terminal") {
    screen = (
      <Shell active="terminal" title="Terminal" breadcrumb="Claude Code · sesi interaktif" onNavigate={setSection} wide>
        {gate(projectsView.length === 0
          ? <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="Terminal butuh project dengan repoDir untuk dijalankan."
              action={() => setModal("project")} actionLabel="Project baru" />
          : <TerminalScreen projects={projectsView} />)}
      </Shell>
    );
  } else if (section === "docs") {
    screen = (
      <Shell active="docs" title="Source of Truth" breadcrumb={proj ? proj.name : "workspace"}
        onNavigate={setSection} wide
        actions={proj && <>
          <Select size="sm" value={proj.id} onChange={(e) => setProjectId(e.target.value)}
            options={projectsView.map((p) => ({ value: p.id, label: p.name }))} />
          <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => deleteProject(proj)}>Hapus project</Button>
        </>}>
        {gate(proj
          ? <DocsWorkspace projectId={proj.id} projectName={proj.name} docStatus={proj.docStatus} />
          : <StateBlock kind="empty" icon="book-open" title="Belum ada project"
              hint="Source of Truth muncul setelah ada project yang dipantau."
              action={() => setModal("project")} actionLabel="Project baru" />)}
      </Shell>
    );
  } else if (section === "triggers") {
    screen = (
      <Shell active="triggers" title="Triggers" breadcrumb="automation · plan + execute" onNavigate={setSection}
        actions={<Button size="sm" leftIcon="plus" onClick={() => setModal("trigger")}>Trigger baru</Button>}>
        {gate(<TriggersScreen triggers={triggers} onToggle={toggleTrigger} onDelete={deleteTrigger} onNew={() => setModal("trigger")} pageSize={5} />)}
      </Shell>
    );
  } else if (section === "settings") {
    screen = (
      <Shell active="settings" title="Settings" breadcrumb="nafanesia.id · workspace" onNavigate={setSection}>
        <SettingsScreen onToast={showToast} />
      </Shell>
    );
  }

  return (
    <>
      {screen}
      <NewSpecModal open={modal === "brief"} onClose={() => setModal(null)} projects={projectsView} defaultProject={proj ? proj.id : ""} onCreate={createSpec} />
      <NewTriggerModal open={modal === "trigger"} onClose={() => setModal(null)} projects={projectsView} defaultProject={proj ? proj.id : ""} onCreate={createTrigger} />
      <NewProjectModal open={modal === "project"} onClose={() => setModal(null)} onCreate={createProject} />
      <Toast toast={toast} />
    </>
  );
}
