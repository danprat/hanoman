import React from "react";
import { Icon } from "../ds/icon";
import { useUpdate, updateHeadline, updateBadgeLabel } from "../api/update";

// Badge topbar — muncul HANYA saat updateAvailable (up-to-date: tanpa noise). Klik → popover berisi
// apa yang baru + perintah update (Salin). Server tak mengeksekusi apa pun (SPEC-214, ADR-0043).
export function UpdateBadge() {
  const u = useUpdate();
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  if (!u.updateAvailable) return null;
  const copy = () => {
    try { void navigator.clipboard?.writeText(u.command); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard tak tersedia */ }
  };
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} title="Update tersedia"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--brass-300, var(--border-hair))",
          background: "var(--brass-100)", color: "var(--brass-700)", cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 12 }}>
        <Icon name="arrow-up-circle" size={13} color="var(--brass-700)" />
        {updateBadgeLabel(u)}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 320,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,.12))", padding: 14 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>Update tersedia</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-body)", marginBottom: 10 }}>{updateHeadline(u)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: u.newCommits.length ? 10 : 8 }}>
            <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--bone-100)",
              padding: "6px 8px", borderRadius: "var(--radius-sm)", overflowX: "auto", whiteSpace: "nowrap" }}>{u.command}</code>
            <button onClick={copy} title="Salin perintah"
              style={{ padding: "5px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hair)",
                background: "var(--bone-100)", cursor: "pointer", fontSize: 11 }}>{copied ? "Tersalin" : "Salin"}</button>
          </div>
          {u.newCommits.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
              {u.newCommits.map((c) => (
                <div key={c.sha} style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis" }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--brass-700)" }}>{c.sha}</span> {c.subject}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>terpasang {u.currentSha || "?"} · tersedia {u.checkoutSha || "?"}</div>
        </div>
      )}
    </div>
  );
}
