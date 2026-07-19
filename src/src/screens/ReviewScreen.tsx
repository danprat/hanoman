/* ReviewScreen (SPEC-171) — review file worktree backlog item ala VSCode:
   sidebar CHANGED (SCM) + FILES (tree), viewer Diff|Source. Read-only. */
import React from "react";
import { Card, Badge, Button, Icon, StateBlock } from "../ds";
import { api, type SpecReview, type ReviewFile, type ChangedFile } from "../api/client";
import { buildFileTree, TreeRow, ST_COLOR } from "./file-tree";

function DiffView({ diff }: { diff: string }) {
  if (!diff) return <StateBlock kind="empty" icon="check" title="Tidak ada perubahan pada file ini"
    hint="File ini bagian dari project tapi tak diubah backlog ini." />;
  return (
    <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.6 }}>
      {diff.split("\n").map((line, i) => {
        const plus = line.startsWith("+") && !line.startsWith("+++");
        const minus = line.startsWith("-") && !line.startsWith("---");
        const hunk = line.startsWith("@@");
        const color = plus ? "var(--leaf-600)" : minus ? "var(--clay-600)" : hunk ? "var(--brass-700)" : "var(--text-body)";
        const bg = plus ? "color-mix(in srgb, var(--leaf-500) 10%, transparent)"
          : minus ? "color-mix(in srgb, var(--clay-500) 10%, transparent)" : "transparent";
        return <div key={i} style={{ color, background: bg, padding: "0 12px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line || " "}</div>;
      })}
    </pre>
  );
}

// SPEC-171/230 · review worktree. kind="spec" (backlog item) atau "session" (sesi project-level
// PRD, tanpa Spec) memilih endpoint yang dipakai — bentuk data & UI identik.
export function ReviewScreen({ specId, title, onBack, kind = "spec" }:
  { specId: string; title: string; onBack: () => void; kind?: "spec" | "session" }) {
  const fetchReview = kind === "session" ? api.sessionReview : api.specReview;
  const fetchFile = kind === "session" ? api.sessionReviewFile : api.specReviewFile;
  const [review, setReview] = React.useState<SpecReview | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error" | "empty">("loading");
  const [errMsg, setErrMsg] = React.useState("");
  const [selected, setSelected] = React.useState("");
  const [file, setFile] = React.useState<ReviewFile | null>(null);
  const [tab, setTab] = React.useState<"diff" | "source">("diff");
  const [tries, setTries] = React.useState(0);
  const [chView, setChView] = React.useState<"list" | "tree">("list");

  React.useEffect(() => {
    let alive = true;
    setState("loading");
    fetchReview(specId).then((r) => {
      if (!alive) return;
      setReview(r); setState("ready");
      setSelected(r.changed[0]?.path ?? r.files[0] ?? "");
    }).catch((e) => {
      if (!alive) return;
      // 409 (worktree/repoDir) → empty jelas, bukan error merah.
      if (e?.status === 409) { setState("empty"); setErrMsg(String(e?.message ?? "")); }
      else setState("error");
    });
    return () => { alive = false; };
  }, [specId, tries]);

  React.useEffect(() => {
    if (!selected) { setFile(null); return; }
    let alive = true;
    setFile(null);
    fetchFile(specId, selected)
      .then((f) => { if (alive) setFile(f); })
      .catch(() => { if (alive) setFile(null); });
    return () => { alive = false; };
  }, [specId, selected]);

  const tree = React.useMemo(() => buildFileTree(review?.files ?? []), [review]);
  const changed = review?.changed ?? [];
  const changedTree = React.useMemo(() => buildFileTree(changed.map((c) => c.path)), [review]);
  const changedMeta = React.useMemo(
    () => Object.fromEntries(changed.map((c) => [c.path, c])) as Record<string, ChangedFile>, [review]);

  if (state === "loading") return <StateBlock kind="loading" title="Memuat review…" hint={specId} />;
  if (state === "error") return <StateBlock kind="error" title="Gagal memuat review" hint={specId} action={() => setTries((n) => n + 1)} />;
  if (state === "empty") return <StateBlock kind="empty" icon="git-branch" title="Belum ada worktree untuk di-review"
    hint={errMsg || "Jalankan atau lanjutkan sesi backlog item ini dulu."} action={onBack} actionLabel="Kembali ke backlog" />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
      <Card padding={0}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border-hair)" }}>
          <span className="hn-eyebrow">{specId}</span>
          <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={() => setTries((n) => n + 1)}>Muat ulang</Button>
        </div>
        <div style={{ maxHeight: 640, overflow: "auto", padding: "6px 4px" }}>
          <div className="hn-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
            <span style={{ flex: 1 }}>Changed · {changed.length}</span>
            {changed.length > 0 && (["list", "tree"] as const).map((v) => (
              <button key={v} aria-label={v === "list" ? "List changed" : "Tree changed"} onClick={() => setChView(v)}
                style={{ display: "flex", padding: 3, border: "none", cursor: "pointer", borderRadius: 4,
                  background: chView === v ? "var(--brass-100)" : "transparent" }}>
                <Icon name={v === "list" ? "list" : "folder-tree"} size={14}
                  color={chView === v ? "var(--brass-700)" : "var(--text-subtle)"} />
              </button>
            ))}
          </div>
          {changed.length === 0
            ? <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--text-subtle)" }}>Tak ada file berubah.</div>
            : chView === "tree"
            ? changedTree.map((n) => <TreeRow key={n.path} node={n} selected={selected} onSelect={setSelected} meta={changedMeta} defaultOpen />)
            : changed.map((c: ChangedFile) => {
              const on = c.path === selected;
              return (
                <button key={c.path} onClick={() => setSelected(c.path)} style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 10px",
                  border: "none", cursor: "pointer", textAlign: "left",
                  background: on ? "var(--brass-100)" : "transparent",
                }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: ST_COLOR[c.status] }}>{c.status}</span>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 12,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: on ? "var(--brass-700)" : "var(--text-body)" }}>{c.path}</span>
                  {!c.binary && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    <span style={{ color: "var(--leaf-600)" }}>+{c.add}</span>{" "}
                    <span style={{ color: "var(--clay-500)" }}>−{c.del}</span>
                  </span>}
                </button>
              );
            })}
          <div className="hn-eyebrow" style={{ padding: "6px 8px", marginTop: 8, borderTop: "1px solid var(--border-hair)" }}>Files</div>
          {tree.map((n) => <TreeRow key={n.path} node={n} selected={selected} onSelect={setSelected} />)}
        </div>
      </Card>

      <Card padding={0}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
          <Icon name="file-text" size={15} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>{selected || "—"}</span>
          {file?.status && <Badge tone={file.status === "D" ? "err" : file.status === "A" ? "ok" : "brass"} size="sm">{file.status}</Badge>}
          <span style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 2, background: "var(--bone-100)", borderRadius: "var(--radius-pill)", padding: 2 }}>
            {(["diff", "source"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "4px 12px", border: "none", cursor: "pointer", borderRadius: "var(--radius-pill)",
                fontSize: 12, textTransform: "capitalize",
                background: tab === t ? "var(--surface-card)" : "transparent",
                color: tab === t ? "var(--text-strong)" : "var(--text-muted)", fontWeight: tab === t ? 600 : 400,
              }}>{t}</button>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: 640, overflow: "auto", background: "var(--surface-card)" }}>
          {!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file" hint="Pilih file dari changed atau tree." />
            : !file ? <StateBlock kind="loading" title="Memuat file…" hint={selected} />
            : file.binary ? <StateBlock kind="empty" icon="file" title="Berkas biner" hint="Tak dapat di-review dari dashboard." />
            : tab === "diff" ? <div style={{ padding: "10px 0" }}><DiffView diff={file.diff ?? ""} />
                {file.truncated && <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-subtle)" }}>… dipotong pada 256 KB.</div>}</div>
            : file.content === null ? <StateBlock kind="empty" icon="trash-2" title="File dihapus" hint="Tak ada isi untuk ditampilkan." />
            : <pre style={{ margin: 0, padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: 12.5,
                lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-body)" }}>{file.content}</pre>}
        </div>
      </Card>
    </div>
  );
}
