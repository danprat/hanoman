/* App.tsx — navigation + state, wired to the API. Ported from the
   prototype App.jsx: window.HN → api.* on mount; every mutating handler
   calls the client and updates state from the response. */
import React from "react";
import { NotificationsProvider } from "./notifications/NotificationsContext";
import { Shell, Modal, Field, HnTextarea, Button, StatusPill, Select, Input, Tabs, Toast, useToast, Icon, StateBlock } from "./ds";
import { api, ApiError, type TerminalSession } from "./api/client";
import type { ProjectView, Spec, AuthStatus, UserView } from "@hanoman/shared";
import { AuthScreen } from "./screens/AuthScreen";
import type { ProjectVM } from "./screens/types";
import { branchOptions } from "./screens/branch";
import { OverviewScreen } from "./screens/OverviewScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { ProjectDetailScreen } from "./screens/ProjectDetailScreen";
import { BacklogScreen } from "./screens/BacklogScreen";
import { TerminalScreen } from "./screens/TerminalScreen";
import { IdeScreen } from "./screens/IdeScreen";
import { VpsScreen } from "./screens/VpsScreen";
import { DocsWorkspace } from "./screens/DocsWorkspace";
import { ReviewScreen } from "./screens/ReviewScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

const SEVERITY =[{ value: "critical", label: "Critical" }, { value: "major", label: "Major" }, { value: "minor", label: "Minor" }];
const PRIORITY = [{ value: "tinggi", label: "Tinggi" }, { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" }];

type SpecForm = { kind: string; project: string; title: string; context: string; outcome: string; constraints: string;
  priority: string; severity: string; steps: string; expected: string; actual: string; env: string; branchFrom: string };

function NewSpecModal({ open, onClose, projects, defaultProject, onCreate }:
  { open: boolean; onClose: () => void; projects: ProjectVM[]; defaultProject: string; onCreate: (f: SpecForm) => void }) {
  const blank: SpecForm = { kind: "brief", project: defaultProject, title: "", context: "", outcome: "", constraints: "",
    priority: "sedang", severity: "major", steps: "", expected: "", actual: "", env: "", branchFrom: "" };
  const [f, setF] = React.useState<SpecForm>(blank);
  React.useEffect(() => { if (open) setF({ ...blank, project: defaultProject }); }, [open, defaultProject]);
  const [branches, setBranches] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!open || !f.project) { setBranches([]); return; }
    let alive = true;
    api.listBranches(f.project)
      .then((r) => {
        if (!alive) return;
        setBranches(r.branches);
        // ganti project → branch pilihan lama bisa tak ada di repo baru; server akan menolaknya (400)
        setF((s) => (s.branchFrom && !r.branches.includes(s.branchFrom) ? { ...s, branchFrom: "" } : s));
      })
      .catch(() => { if (alive) setBranches([]); });
    return () => { alive = false; };
  }, [open, f.project]);
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
      <Field label="Branch" hint="branch yang di-copy ke git worktree saat run">
        <Select value={f.branchFrom} onChange={set("branchFrom")} disabled={!branches.length}
          style={{ width: "100%" }} options={branchOptions(branches)} />
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

function EditProjectModal({ open, project, onClose, onSave }:
  { open: boolean; project?: ProjectVM; onClose: () => void; onSave: (f: { name: string; desc: string }) => void }) {
  const [f, setF] = React.useState({ name: "", desc: "" });
  React.useEffect(() => { if (open && project) setF({ name: project.name, desc: project.desc }); }, [open, project]);
  const canSubmit = !!f.name.trim();
  return (
    <Modal open={open} onClose={onClose} icon="pencil" eyebrow={project ? project.id : "project"}
      title="Edit project"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" onClick={() => canSubmit && onSave(f)}>Simpan</Button>
      </>}>
      {/* `id` tak ikut: ia kunci asing spec/run/trigger (SPEC-146). */}
      <Field label="Nama project" hint="label tampilan — boleh berbeda dari id">
        <Input value={f.name} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, name: e.target.value }))}
          style={{ width: "100%" }} />
      </Field>
      <Field label="Deskripsi">
        <Input value={f.desc} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, desc: e.target.value }))}
          style={{ width: "100%" }} />
      </Field>
    </Modal>
  );
}

export default function App() {
  const [section, setSection] = React.useState("overview");
  const [projects, setProjects] = React.useState<ProjectView[]>([]);
  const [backlog, setBacklog] = React.useState<Spec[]>([]);
  // Pekerjaan yang berjalan adalah sesi tmux, bukan baris Run (SPEC-162).
  const [sessions, setSessions] = React.useState<TerminalSession[]>([]);
  const [projectId, setProjectId] = React.useState("");
  const [reviewSpecId, setReviewSpecId] = React.useState("");
  // Pemilik tunggal "daftar disaring ke project mana?" (SPEC-146). Sengaja terpisah dari
  // `projectId` ("project yang sedang dibuka Docs/detail"): menyatukannya membuat klik
  // sidebar Runs diam-diam menyaring ke project terakhir yang dibuka Docs.
  const [projectFilter, setProjectFilter] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [modal, setModal] = React.useState<string | null>(null);
  const [toast, showToast] = useToast();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  // SPEC-169 · gate auth. null = belum tahu (splash). Sesi kedaluwarsa (401) → balik ke Login.
  const [auth, setAuth] = React.useState<AuthStatus | null>(null);
  const onLoggedOut = React.useCallback(() => setAuth({ needsSetup: false, user: null }), []);
  React.useEffect(() => { api.authStatus().then(setAuth).catch(() => setAuth({ needsSetup: false, user: null })); }, []);

  const load = React.useCallback(() => {
    setStatus("loading");
    Promise.all([api.listProjects(), api.listSpecs(), api.listTerminals()])
      .then(([p, s, t]) => {
        setProjects(p); setBacklog(s); setSessions(t);
        setProjectId((cur) => cur || p[0]?.id || "");
        setStatus("ready");
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) { onLoggedOut(); return; }
        setStatus("error");
        showToast("Gagal memuat data dari server", "err", "x-circle");
      });
  }, [showToast, onLoggedOut]);
  // Muat data hanya setelah login; run baru pada perubahan status login.
  React.useEffect(() => { if (auth?.user) load(); }, [load, auth?.user]);

  // ProjectVM dulu membawa daftar tipe trigger per project; trigger sudah tak ada (SPEC-162).
  const projectsView: ProjectVM[] = projects;

  // Spec yang punya sesi claude hidup. Kartunya menawarkan "Buka sesi", bukan "Mulai".
  const activeSpecs = React.useMemo(
    () => new Set(sessions.filter((s) => s.specId && !s.exited).map((s) => s.specId as string)),
    [sessions]);

  // Stage bergerak saat sesi ditutup — server membaca berkas fase sekali terakhir — dan sesi
  // bisa mati dari luar hanoman. Selama ada sesi hidup, poll ringan menjaga board jujur.
  const anySessionActive = activeSpecs.size > 0;
  React.useEffect(() => {
    if (!anySessionActive) return;
    const t = setInterval(() => {
      Promise.all([api.listSpecs(), api.listTerminals()])
        .then(([s, t]) => { setBacklog(s); setSessions(t); })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [anySessionActive]);

  const proj = projectsView.find((p) => p.id === projectId) || projectsView[0];
  const q = search.trim().toLowerCase();
  const shownProjects = q
    ? projectsView.filter((p) => (p.name + " " + p.desc + " " + p.stack).toLowerCase().includes(q))
    : projectsView;

  function openProject(p: ProjectVM) { setProjectId(p.id); setSection("project"); }
  // SPEC-171 · buka layar review file worktree sebuah backlog item.
  function openReview(s: Spec) { setReviewSpecId(s.id); setSection("review"); }

  async function updateProject(f: { name: string; desc: string }) {
    if (!proj) return;
    try {
      const updated = await api.updateProject(proj.id, { name: f.name.trim(), desc: f.desc.trim() });
      setProjects((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      setModal(null);
      showToast("Project " + updated.name + " diperbarui", "ok", "box");
    } catch { showToast("Gagal memperbarui project", "err", "x-circle"); }
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

  // Cascade di DB ikut menghapus spec project ini — cermin state lokalnya.
  async function deleteProject(p: ProjectVM) {
    if (!window.confirm(`Hapus project "${p.name}"? Semua spec-nya ikut terhapus.`)) return;
    try {
      await api.deleteProject(p.id);
      setProjects((list) => list.filter((x) => x.id !== p.id));
      setBacklog((b) => b.filter((s) => s.projectId !== p.id));
      setSessions((t) => t.filter((x) => x.projectId !== p.id));
      setProjectId((cur) => (cur === p.id ? "" : cur));
      setProjectFilter((cur) => (cur === p.id ? "all" : cur));
      if (section === "docs" || section === "project") setSection("projects");
      showToast("Project " + p.id + " dihapus", "warn", "trash-2");
    } catch (e) {
      const busy = e instanceof ApiError && e.status === 409;
      showToast("Gagal hapus " + p.id + (busy ? " · masih ada sesi aktif" : ""), "err", "x-circle");
    }
  }

  // SPEC-162 · Start membuka sesi claude interaktif di worktree backlog item ini, lalu pindah
  // ke layar Terminal: di sanalah pekerjaannya terlihat, dan di sanalah manusia menjawab agen.
  // `branchFrom` tak dikirim — server membacanya dari baris Spec (SPEC-143).
  async function startSession(spec: Spec) {
    try {
      const { id } = await api.startSession({ spec: spec.id, flow: spec.source === "qa" ? "qa" : "feature" });
      setSection("terminal");
      showToast(spec.id + " · sesi " + id + " dimulai", "info", "play");
    } catch (e) {
      const noRepo = e instanceof ApiError && e.status === 400;
      showToast(spec.id + " · gagal mulai sesi" + (noRepo ? " · project belum punya repoDir" : ""), "warn", "x-circle");
    }
  }

  // SPEC-175 · rebase/merge branch hasil sebuah done spec. Bersih → toast; conflict → pindah ke
  // Terminal tempat sesi claude membereskan konflik (pola startSession).
  async function integrateSpec(spec: Spec, op: "merge" | "rebase", target: string) {
    try {
      const r = await api.integrateSpec(spec.id, op, target);
      if (r.status === "conflict") {
        setSection("terminal");
        showToast(`${spec.id} · konflik ${op} — selesaikan di Terminal`, "warn", "git-merge");
      } else {
        showToast(`${spec.id} · ${op} berhasil · ${r.detail}`, "ok", "git-merge");
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      showToast(`${spec.id} · gagal ${op}` + (code === 409 ? " · cek target/branch" : ""), "err", "x-circle");
    }
  }

  // SPEC-166 · Reverse docs: sesi interaktif menyusun Source of Truth dari kode. Fase
  // Wawancara hidup di layar Terminal — di sanalah manusia menjawab agen.
  async function reverseDocs(p: ProjectVM) {
    try {
      const { id } = await api.reverseDocs(p.id);
      setSection("terminal");
      showToast(p.id + " · reverse docs · sesi " + id + " dimulai", "info", "radar");
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 422 || e.status === 400);
      showToast(p.id + " · gagal mulai reverse" + (noRepo ? " · project belum punya repoDir" : ""), "warn", "x-circle");
    }
  }

  // SPEC-143. Hanya menentukan basis run BERIKUTNYA; run yang sudah jalan diubah dari layar Runs.
  async function editBranch(spec: Spec, branchFrom: string | null) {
    try {
      const updated = await api.patchSpec(spec.id, { branchFrom });
      if ("pending" in updated) return; // dry-run hanya untuk revert stage — tak mungkin di sini
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(spec.id + " · branch " + (branchFrom ?? "main (default project)"), "ok", "git-branch");
    } catch { showToast("Gagal mengubah branch " + spec.id, "err", "x-circle"); }
  }

  // SPEC-167 · revert backward-only. Respons `pending` = dry-run: kembalikan ke pemanggil
  // supaya dialog konfirmasi muncul; hanya panggilan confirmDelete yang mengubah state.
  async function revertStage(spec: Spec, target: string, confirmDelete?: boolean) {
    try {
      const res = await api.patchSpec(spec.id, { stage: target, confirmDelete });
      if ("pending" in res) return res;
      setBacklog((b) => b.map((s) => (s.id === res.id ? res : s)));
      showToast(spec.id + " dikembalikan ke " + target, "warn", "rotate-ccw");
      return res;
    } catch { showToast("Gagal mengembalikan stage " + spec.id, "err", "x-circle"); return undefined; }
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
      const created = await api.createSpec({ project: f.project, source: f.kind, title: f.title.trim(),
        priority: f.priority, payload, branchFrom: f.branchFrom || undefined });
      setBacklog((b) => [created, ...b]);
      setModal(null); setSection("backlog");
      showToast(created.id + (isQa ? " difilekan · masuk audit" : " dibuat · masuk brainstorm"), "ok", isQa ? "bug" : "lightbulb");
    } catch { showToast("Gagal membuat spec", "err", "x-circle"); }
  }

  // Fetch awal dipakai semua screen kecuali Settings, jadi loading/error-nya
  // digerbangkan satu kali di sini.
  const gate = (body: React.ReactNode) =>
    status === "loading" ? <StateBlock kind="loading" title="Memuat workspace…" />
      : status === "error" ? <StateBlock kind="error" title="Gagal memuat data dari server"
          hint="Pastikan server hanoman berjalan, lalu coba lagi." action={load} />
      : body;

  // SPEC-169 · gerbang auth: splash → Setup/Login → app.
  if (!auth) return <StateBlock kind="loading" title="Memuat hanoman…" />;
  if (!auth.user) return <AuthScreen needsSetup={auth.needsSetup} onDone={(u) => setAuth({ needsSetup: false, user: u })} />;
  const me: UserView = auth.user;

  let screen: React.ReactNode = null;
  if (section === "overview") {
    screen = (
      <Shell active="overview" title="Overview" breadcrumb="nafanesia.id · ringkasan workspace" onNavigate={setSection}>
        {gate(<OverviewScreen projects={projectsView} backlog={backlog}
          onOpenProject={openProject} onGoto={setSection} />)}
      </Shell>
    );
  } else if (section === "projects") {
    screen = (
      <Shell active="projects" title="Projects" breadcrumb="nafanesia.id · workspace"
        showSearch searchValue={search} onSearchChange={setSearch} onNavigate={setSection}
        actions={<Button size="sm" leftIcon="plus" onClick={() => setModal("project")}>Project baru</Button>}>
        {gate(
          projectsView.length === 0
            ? <StateBlock kind="empty" icon="box" title="Belum ada project"
                hint="Mulai dari nol atau tambahkan codebase yang sudah ada — hanoman menyusun Source of Truth-nya."
                action={() => setModal("project")} actionLabel="Project baru" />
            : shownProjects.length === 0
              ? <StateBlock kind="empty" icon="search" title={`Tidak ada project cocok dengan “${search}”`}
                  hint="Coba kata kunci lain, atau kosongkan pencarian."
                  action={() => setSearch("")} actionLabel="Hapus pencarian" actionIcon="x" />
              : <ProjectsScreen projects={shownProjects} variant="list" onOpen={openProject} onDelete={deleteProject} pageSize={20} />)}
      </Shell>
    );
  } else if (section === "project") {
    screen = (
      <Shell active="projects" title={proj ? proj.name : "Project"}
        breadcrumb={proj ? "projects · " + proj.id : "projects"} onNavigate={setSection}>
        {gate(proj
          ? <ProjectDetailScreen p={proj} onEdit={() => setModal("project-edit")}
              onGotoDocs={() => setSection("docs")}
              onGotoTerminal={() => { setProjectFilter(proj.id); setSection("terminal"); }}
              onGotoBacklog={() => { setProjectFilter(proj.id); setSection("backlog"); }}
              onReverse={proj.kind === "existing" && proj.repoDir ? () => reverseDocs(proj) : undefined}
              onDelete={() => deleteProject(proj)} />
          : <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="Mulai dari nol atau tambahkan codebase yang sudah ada."
              action={() => setModal("project")} actionLabel="Project baru" />)}
      </Shell>
    );
  } else if (section === "backlog") {
    screen = (
      <Shell active="backlog" title="Backlog" breadcrumb="specs · brainstorm → execute" onNavigate={setSection}
        actions={<Button size="sm" leftIcon="plus" onClick={() => setModal("brief")}>Tambah</Button>}>
        {gate(<BacklogScreen backlog={backlog} projects={projectsView} pageSize={20}
          onStart={startSession} activeSpecs={activeSpecs} onNew={() => setModal("brief")}
          onDelete={deleteSpec} onOpenRun={() => setSection("terminal")} onOpenReview={openReview}
          onEditBranch={editBranch} onRevertStage={revertStage} onIntegrate={integrateSpec}
          projectFilter={projectFilter} onProjectFilter={setProjectFilter} />)}
      </Shell>
    );
  } else if (section === "terminal") {
    screen = (
      <Shell active="terminal" title="Terminal" breadcrumb="Claude Code · sesi interaktif" onNavigate={setSection} wide>
        {gate(projectsView.length === 0
          ? <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="Terminal butuh project dengan repoDir untuk dijalankan."
              action={() => setModal("project")} actionLabel="Project baru" />
          : <TerminalScreen projects={projectsView} backlog={backlog}
              onOpenReview={(specId) => { setReviewSpecId(specId); setSection("review"); }}
              titleOf={(id) => backlog.find((s) => s.id === id)?.title}
              onIntegrate={integrateSpec} specOf={(id) => backlog.find((s) => s.id === id)} />)}
      </Shell>
    );
  } else if (section === "ide") {
    // SPEC-182 · IDE Visual: explorer + branch switch + git graph, difilter per project.
    screen = (
      <Shell active="ide" title="IDE" breadcrumb={proj ? proj.name : "workspace"} onNavigate={setSection} wide>
        {gate(projectsView.length === 0
          ? <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="IDE butuh project dengan repoDir." action={() => setModal("project")} actionLabel="Project baru" />
          : <IdeScreen projects={projectsView} projectId={proj ? proj.id : projectsView[0]!.id}
              onProject={(id) => setProjectId(id)} />)}
      </Shell>
    );
  } else if (section === "vps") {
    // VpsScreen memuat datanya sendiri — tak lewat `gate`, yang menunggu project/backlog.
    screen = (
      <Shell active="vps" title="VPS" breadcrumb="infra · audit → harden" onNavigate={setSection}>
        <VpsScreen onToast={showToast} onGotoTerminal={() => setSection("terminal")} />
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
  } else if (section === "review") {
    // SPEC-171 · layar review file worktree backlog item (all files + file changed).
    const rspec = backlog.find((s) => s.id === reviewSpecId);
    screen = (
      <Shell active="backlog" title="Review" wide onNavigate={setSection}
        breadcrumb={rspec ? "backlog · " + rspec.id : "backlog"}
        actions={<Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={() => setSection("backlog")}>Kembali</Button>}>
        {gate(reviewSpecId
          ? <ReviewScreen specId={reviewSpecId} title={rspec?.title ?? reviewSpecId} onBack={() => setSection("backlog")} />
          : <StateBlock kind="empty" icon="git-compare" title="Pilih backlog item"
              hint="Buka Review dari sebuah item di Backlog." action={() => setSection("backlog")} actionLabel="Ke Backlog" />)}
      </Shell>
    );
  } else if (section === "settings") {
    screen = (
      <Shell active="settings" title="Settings" breadcrumb="nafanesia.id · workspace" onNavigate={setSection}>
        <SettingsScreen onToast={showToast} me={me} onLoggedOut={onLoggedOut} />
      </Shell>
    );
  }

  return (
    <NotificationsProvider showToast={showToast}>
      {screen}
      <NewSpecModal open={modal === "brief"} onClose={() => setModal(null)} projects={projectsView} defaultProject={proj ? proj.id : ""} onCreate={createSpec} />
      <NewProjectModal open={modal === "project"} onClose={() => setModal(null)} onCreate={createProject} />
      <EditProjectModal open={modal === "project-edit"} project={proj} onClose={() => setModal(null)} onSave={updateProject} />
      <Toast toast={toast} />
    </NotificationsProvider>
  );
}
