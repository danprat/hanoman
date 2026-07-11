import React from "react";
import type { LimitsDTO } from "@hanoman/shared";
// Import langsung dari file komponen, bukan barrel `../ds`: barrel meng-ekspor `Shell`, dan
// shell.tsx meng-import <LimitBadge> dari sini — lewat barrel itu jadi siklus impor.
import { ProgressBar } from "../ds/components/feedback";
import { useLimits, worstWindow, severityToken, severityTone } from "../api/limits";

function resetLabel(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "reset segera";
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000);
  return h >= 1 ? `reset ${h}j ${m}m` : `reset ${m}m`;
}
function agoLabel(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m <= 0 ? "baru saja" : `${m}m lalu`;
}

// Daftar window — dipakai popover badge DAN kartu Overview (satu presentasi).
export function LimitWindows({ dto }: { dto: LimitsDTO }) {
  if (!dto.windows.length)
    return (
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", padding: "4px 0" }}>
        {dto.status === "unavailable"
          ? "Limit tidak tersedia — Claude idle / belum login di host ini."
          : "Belum ada data limit."}
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {dto.windows.map((w) => {
        const tok = severityToken(w.severity);
        return (
          <div key={w.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-body)" }}>
                {w.label}{w.isActive ? " · aktif" : ""}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: tok.fg }}>{w.usedPct}%</span>
            </div>
            <ProgressBar value={w.usedPct} max={100} tone={severityTone(w.severity)} size="sm" />
            {w.resetsAt && (
              <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>{resetLabel(w.resetsAt)}</span>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 2 }}>
        {dto.status === "stale" ? `stale · diperbarui ${agoLabel(dto.fetchedAt)}` : `diperbarui ${agoLabel(dto.fetchedAt)}`}
      </div>
    </div>
  );
}

// Badge top bar — self-fetch via useLimits(), tanpa props. Shell cukup merender <LimitBadge/>.
export function LimitBadge() {
  const dto = useLimits();
  const worst = worstWindow(dto.windows);
  const [open, setOpen] = React.useState(false);
  const label = dto.status === "unavailable" || !worst ? "—" : `${worst.usedPct}%`;
  const tok = worst ? severityToken(worst.severity) : { fg: "var(--text-muted)", bg: "var(--bone-200)" };
  const dim = dto.status === "stale" ? 0.6 : 1;
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Limit Claude"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--border-hair)",
          background: tok.bg, color: tok.fg, opacity: dim, cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 12,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 999, background: tok.fg }} />
        {label}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 280,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,.12))",
          padding: 14,
        }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>Limit Claude</div>
          <LimitWindows dto={dto} />
        </div>
      )}
    </div>
  );
}
