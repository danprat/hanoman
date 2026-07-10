/* ProjectDetailScreen — satu project: identitas, edit, dan tiga pintu ke docs/runs/backlog.
   Tak ada fetch sendiri: ProjectVM dari daftar sudah memuat setiap field yang dirender
   (SPEC-146). GET /projects/:id ada, tapi memanggilnya hanya menambah state loading. */
import { Card, Badge, StatusPill, ProgressBar, Button, Icon } from "../ds";
import type { ProjectVM } from "./types";

const COV_TONE = (s: string) => (s === "broken" ? "err" : s === "drift" ? "warn" : "ok");

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="hn-eyebrow">{label}</div>
      <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-body)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function Door({ icon, title, hint, onClick }:
  { icon: string; title: string; hint: string; onClick: () => void }) {
  return (
    <Card padding={0}>
      <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", cursor: "pointer" }}>
        <Icon name={icon} size={16} color="var(--text-muted)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{title}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>{hint}</div>
        </div>
        <Icon name="chevron-right" size={14} color="var(--text-subtle)" />
      </div>
    </Card>
  );
}

export function ProjectDetailScreen({ p, onEdit, onGotoDocs, onGotoTerminal, onGotoBacklog, onDelete }:
  { p: ProjectVM; onEdit: () => void; onGotoDocs: () => void; onGotoTerminal: () => void;
    onGotoBacklog: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="box" size={15} color="var(--text-muted)" />
              <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600,
                color: "var(--text-strong)" }}>{p.name}</span>
              <Badge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{p.kind}</Badge>
              <StatusPill status={p.session.status} size="sm">{p.session.phase ?? undefined}</StatusPill>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-subtle)", marginTop: 6 }}>{p.desc}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            <Button size="sm" variant="secondary" leftIcon="pencil" onClick={onEdit}>Edit project</Button>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={onDelete}>Hapus project</Button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 20 }}>
          <Meta label="ID" value={p.id} mono />
          <Meta label="Repo" value={p.repoDir || "—"} mono />
          <Meta label="Stack" value={p.stack || "—"} />
          <Meta label="Backlog terbuka" value={`${p.backlog} · ${p.topStage}`} />
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Docs · SoT</div>
          <ProgressBar value={p.coverage} showLabel tone={COV_TONE(p.docStatus)} size="sm" />
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Door icon="book-open" title="Source of Truth" hint="baca & sunting docs" onClick={onGotoDocs} />
        <Door icon="terminal" title="Buka terminal" hint="sesi claude project ini" onClick={onGotoTerminal} />
        <Door icon="list-checks" title="Lihat backlog" hint={`${p.backlog} spec terbuka`} onClick={onGotoBacklog} />
      </div>
    </div>
  );
}
