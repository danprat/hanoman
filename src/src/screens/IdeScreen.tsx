/* IdeScreen — IDE Visual (SPEC-182): Explorer (pohon file + editor highlight) & Git Graph,
   satu toolbar (project + branch switcher). Pola tree/editor meniru DocsWorkspace. */
import React from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import { Card, Button, Select, Icon, StateBlock, Tabs, Badge } from "../ds";
import { api, ApiError, type RepoFile, type GitOp } from "../api/client";
import type { ProjectVM } from "./types";
import { GitGraph } from "./GitGraph";
import { buildFileTree, TreeRow } from "./file-tree";

const langOf = (p: string): string => {
  const ext = p.slice(p.lastIndexOf(".") + 1);
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "xml", sh: "bash", py: "python", yml: "yaml", yaml: "yaml", sql: "sql" };
  return map[ext] ?? "";
};

// Dialog "Paksa": muncul saat mutasi git balas 409. Mengulang op dengan force:true.
function ForceDialog({ msg, onForce, onCancel }: { msg: string; onForce: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,.35)",
      display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card padding={20} style={{ maxWidth: 460 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--text-strong)" }}>Operasi ditolak</div>
        <pre style={{ fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "pre-wrap",
          color: "var(--text-muted)", marginBottom: 12 }}>{msg}</pre>
        <div style={{ fontSize: 12.5, color: "var(--clay-600)", marginBottom: 14 }}>
          Paksa bisa membuang perubahan tak ter-commit &amp; mengganggu sesi Claude yang jalan.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
          <Button size="sm" leftIcon="alert-triangle" onClick={onForce}>Paksa</Button>
        </div>
      </Card>
    </div>
  );
}

export function IdeScreen({ projects, projectId, onProject, onToast, onGotoTerminal }:
  { projects: ProjectVM[]; projectId: string; onProject: (id: string) => void;
    onToast?: (msg: string, tone: "ok" | "warn" | "err" | "info", icon?: string) => void;
    onGotoTerminal?: (sessionId?: string) => void }) {
  const [tab, setTab] = React.useState("explorer");
  const [viewRef, setViewRef] = React.useState("");         // branch/ref yang dilihat (kosong = working tree)
  const [branches, setBranches] = React.useState<{ branches: string[]; remotes: string[] }>({ branches: [], remotes: [] });
  const [files, setFiles] = React.useState<string[]>([]);
  const [treeState, setTreeState] = React.useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = React.useState("");
  const [file, setFile] = React.useState<RepoFile | null>(null);
  const [mode, setMode] = React.useState<"view" | "edit">("view");
  const [draft, setDraft] = React.useState("");
  const [pendingForce, setPendingForce] = React.useState<{ op: GitOp; msg: string } | null>(null);

  const reloadTree = React.useCallback(() => {
    setTreeState("loading");
    api.ideTree(projectId, viewRef).then((t) => { setFiles(t.files); setTreeState("ready"); })
      .catch(() => setTreeState("error"));
  }, [projectId, viewRef]);

  React.useEffect(() => { reloadTree(); }, [reloadTree]);
  React.useEffect(() => { api.listBranches(projectId).then(setBranches).catch(() => {}); }, [projectId]);
  React.useEffect(() => {
    if (!selected) { setFile(null); return; }
    let alive = true;
    api.ideFile(projectId, selected, viewRef).then((f) => { if (alive) { setFile(f); setMode("view"); } })
      .catch(() => { if (alive) setFile(null); });
    return () => { alive = false; };
  }, [selected, projectId, viewRef]);

  // Semua ref: local + origin (prefix "origin/") untuk dilihat/checkout.
  const refOptions = [
    { value: "", label: "· working tree ·" },
    ...branches.branches.map((b) => ({ value: b, label: b })),
    ...branches.remotes.map((b) => ({ value: `origin/${b}`, label: `origin/${b}` })),
  ];

  async function runGit(op: GitOp) {
    try {
      const r = await api.ideGit(projectId, op);
      setViewRef(""); reloadTree();
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setPendingForce({ op, msg: e.message });
      throw e;
    }
  }
  async function checkout() { if (viewRef) await runGit({ op: "checkout", ref: viewRef }).catch(() => {}); }
  // SPEC-229 · merge via git graph: deterministik di worktree isolasi. Konflik → pindah Terminal
  // (sesi claude), bersih → toast + reload, error → toast. Melempar ulang agar mergeAct tak reload salah.
  async function mergeGraph(source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) {
    try {
      const r = await api.ideGitMerge(projectId, { source, ...opts });
      if (r.status === "conflict") { onGotoTerminal?.(r.sessionId); onToast?.("konflik merge — selesaikan di Terminal", "warn", "git-merge"); }
      else { setViewRef(""); reloadTree(); onToast?.(`merge berhasil · ${r.detail}`, "ok", "git-merge"); }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      onToast?.("gagal merge" + (code === 409 ? " · cek branch/target" : ""), "err", "x-circle");
      throw e;
    }
  }
  // SPEC-233 · rebase/pull/drop via git graph: pola mergeGraph — konflik → Terminal, bersih → toast+reload.
  async function graphIsolated(kind: "rebase" | "pull" | "drop", arg: string) {
    try {
      const r = kind === "rebase" ? await api.ideGitRebase(projectId, arg)
        : kind === "pull" ? await api.ideGitPull(projectId, { source: arg })
        : await api.ideGitDrop(projectId, arg);
      if (r.status === "conflict") { onGotoTerminal?.(r.sessionId); onToast?.(`konflik ${kind} — selesaikan di Terminal`, "warn", "git-merge"); }
      else { setViewRef(""); reloadTree(); onToast?.(`${kind} berhasil · ${r.detail}`, "ok", "git-branch"); }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      onToast?.(`gagal ${kind}` + (code === 409 ? " · cek working tree/branch" : ""), "err", "x-circle");
      throw e;
    }
  }
  async function confirmForce() {
    if (!pendingForce) return;
    const op = { ...pendingForce.op, force: true } as GitOp;
    setPendingForce(null);
    await api.ideGit(projectId, op).then(() => { setViewRef(""); reloadTree(); }).catch(() => {});
  }

  function startEdit() { setDraft(file?.content ?? ""); setMode("edit"); }
  async function save() {
    await api.putIdeFile(projectId, selected, draft);
    setFile((f) => (f ? { ...f, content: draft } : f)); setMode("view");
  }

  const highlighted = React.useMemo(() => {
    if (!file || file.content === null) return "";
    const lang = langOf(selected);
    try { return lang ? hljs.highlight(file.content, { language: lang }).value : hljs.highlightAuto(file.content).value; }
    catch { return file.content; }
  }, [file, selected]);

  const toolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <Select size="sm" value={projectId} onChange={(e) => onProject(e.target.value)}
        options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      <Select size="sm" value={viewRef} onChange={(e) => setViewRef(e.target.value)} options={refOptions} />
      <Button size="sm" variant="secondary" leftIcon="git-branch" onClick={checkout} disabled={!viewRef}>Checkout</Button>
      {/* SPEC-233 · fetch --all --prune; ref-only → tak digerbang sesi */}
      <Button size="sm" variant="ghost" leftIcon="download-cloud" onClick={() => { void runGit({ op: "fetch", prune: true }).then(() => api.listBranches(projectId).then(setBranches)).catch(() => {}); }}>Fetch</Button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Tabs tabs={[{ value: "explorer", label: "Explorer" }, { value: "graph", label: "Git Graph" }]} value={tab} onChange={setTab} />
        {toolbar}
      </div>

      {tab === "explorer" ? (
        <div style={{ display: "grid", gridTemplateColumns: "288px 1fr", gap: 20, alignItems: "start" }}>
          <Card padding={0}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-hair)" }}>
              <span className="hn-eyebrow">files · {viewRef || "working tree"}</span>
            </div>
            <div style={{ padding: 8, maxHeight: 620, overflow: "auto" }}>
              {treeState === "loading" ? <StateBlock kind="loading" compact title="Memuat file…" />
                : treeState === "error" ? <StateBlock kind="error" compact title="Gagal memuat file" action={reloadTree} />
                : files.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Tak ada file" />
                : buildFileTree(files).map((n) => (
                    <TreeRow key={n.path} node={n} selected={selected} onSelect={setSelected} />
                  ))}
            </div>
          </Card>
          <Card padding={0}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)" }}>
              <Icon name="file-text" size={15} color="var(--text-muted)" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)" }}>{selected || "—"}</span>
              {file?.truncated && <Badge tone="warn" size="sm">terpotong</Badge>}
              <span style={{ flex: 1 }} />
              {mode === "view"
                ? <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                    disabled={!file || file.binary}>Edit</Button>
                : <div style={{ display: "flex", gap: 8 }}>
                    <Button size="sm" variant="ghost" onClick={() => setMode("view")}>Batal</Button>
                    <Button size="sm" leftIcon="check" onClick={save}>Simpan</Button>
                  </div>}
            </div>
            <div style={{ maxHeight: 620, overflow: "auto" }}>
              {!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file dari pohon di kiri" />
                : file === null ? <StateBlock kind="loading" title="Memuat…" hint={selected} />
                : file.binary ? <StateBlock kind="empty" icon="file" title="File biner" hint={selected} />
                : mode === "edit"
                  ? <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} style={{
                      width: "100%", minHeight: 560, boxSizing: "border-box", resize: "vertical", border: "none",
                      outline: "none", padding: "16px 18px", fontFamily: "var(--font-mono)", fontSize: 12.5,
                      lineHeight: 1.7, color: "var(--text-body)", background: "var(--surface-card)" }} />
                  : <pre style={{ margin: 0, padding: "16px 18px", overflow: "auto" }}>
                      <code className="hljs" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7 }}
                        dangerouslySetInnerHTML={{ __html: highlighted }} />
                    </pre>}
            </div>
          </Card>
        </div>
      ) : (
        <GitGraph projectId={projectId} onRunGit={runGit} onMerge={mergeGraph}
          onRebase={(onto) => graphIsolated("rebase", onto)} onPull={(src) => graphIsolated("pull", src)} onDrop={(sha) => graphIsolated("drop", sha)}
          onOpenFile={(p, ref) => { setViewRef(ref); setSelected(p); setTab("explorer"); }} />
      )}

      {pendingForce && <ForceDialog msg={pendingForce.msg} onForce={confirmForce} onCancel={() => setPendingForce(null)} />}
    </div>
  );
}
