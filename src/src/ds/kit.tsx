/* Ported from .prototype/app/AppUI.jsx — interaction primitives.
   ESM + typed; window global removed. No visual change. */
import React from "react";
import { Icon } from "./icon";

export type ToastData = { message: React.ReactNode; tone?: string; icon?: string; k: number };
export type ShowToast = (message: React.ReactNode, tone?: string, icon?: string) => void;

export function useToast(): [ToastData | null, ShowToast] {
  const [toast, setToast] = React.useState<ToastData | null>(null);
  const tRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = React.useCallback<ShowToast>((message, tone = "ok", icon) => {
    setToast({ message, tone, icon, k: Date.now() });
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setToast(null), 2600);
  }, []);
  return [toast, show];
}

export function Toast({ toast }: { toast: ToastData | null }) {
  if (!toast) return null;
  const tone = toast.tone || "ok";
  const color = tone === "err" ? "var(--clay-500)" : tone === "warn" ? "var(--amber-500)"
    : tone === "info" ? "var(--wind-600)" : "var(--leaf-500)";
  const icon = toast.icon || (tone === "err" ? "x-circle" : tone === "warn" ? "alert-triangle"
    : tone === "info" ? "info" : "check-circle-2");
  return (
    <div key={toast.k} style={{
      position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 200,
      display: "flex", alignItems: "center", gap: 10, padding: "11px 16px",
      background: "var(--surface-inverse)", color: "var(--term-fg)",
      borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xl)",
      fontFamily: "var(--font-sans)", fontSize: 13.5, maxWidth: 460,
      animation: "hn-toast-in 220ms var(--ease-out, ease-out)",
    }}>
      <Icon name={icon} size={16} color={color} />
      <span>{toast.message}</span>
    </div>
  );
}

export function Modal({ open, title, eyebrow, icon, onClose, footer, width = 560, children }:
  { open: boolean; title?: React.ReactNode; eyebrow?: React.ReactNode; icon?: string;
    onClose?: () => void; footer?: React.ReactNode; width?: number; children?: React.ReactNode }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 150, display: "flex", alignItems: "center", justifyContent: "center",
      background: "color-mix(in srgb, var(--ink-900) 42%, transparent)", padding: 24,
      animation: "hn-fade-in 160ms ease-out",
    }}>
      <div style={{
        width, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column",
        background: "var(--surface-card)", borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-hair)", boxShadow: "var(--shadow-xl)", overflow: "hidden",
        animation: "hn-modal-in 200ms var(--ease-out, ease-out)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 20px 14px", borderBottom: "1px solid var(--border-hair)" }}>
          {icon && (
            <span style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", flex: "0 0 auto",
              background: "var(--brass-100)", color: "var(--brass-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={icon} size={17} />
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && <div className="hn-eyebrow" style={{ marginBottom: 3 }}>{eyebrow}</div>}
            <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-strong)", lineHeight: 1.15 }}>{title}</div>
          </div>
          <button onClick={onClose} aria-label="Tutup" style={{
            border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)",
            padding: 4, borderRadius: "var(--radius-sm)", display: "inline-flex",
          }}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ padding: "18px 20px", overflow: "auto" }}>{children}</div>
        {footer && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10,
            padding: "14px 20px", borderTop: "1px solid var(--border-hair)", background: "var(--bone-100)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label?: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, color: "var(--text-strong)", marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 5 }}>{hint}</div>}
    </label>
  );
}

export function HnTextarea({ value, onChange, rows = 3, placeholder, mono = false }:
  { value?: string; onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; rows?: number; placeholder?: string; mono?: boolean }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <textarea value={value} onChange={onChange} rows={rows} placeholder={placeholder}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={{
        display: "block", width: "100%", boxSizing: "border-box", resize: "vertical",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)", fontSize: 13,
        color: "var(--text-strong)", background: "var(--surface-card)",
        border: `1px solid ${focus ? "var(--border-focus)" : "var(--border-strong)"}`,
        borderRadius: "var(--radius-sm)", padding: "9px 11px", lineHeight: 1.5,
        boxShadow: focus ? "var(--ring)" : "var(--shadow-inset)", outline: "none",
      }} />
  );
}

export function usePaged<T>(items: T[], pageSize: number, resetKey?: unknown) {
  const [page, setPage] = React.useState(1);
  React.useEffect(() => { setPage(1); }, [resetKey, items.length]);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(page, pageCount);
  const from = total === 0 ? 0 : (p - 1) * pageSize + 1;
  const to = Math.min(total, p * pageSize);
  const pageItems = items.slice((p - 1) * pageSize, p * pageSize);
  return { pageItems, page: p, setPage, pageCount, total, from, to };
}

function PagerBtn({ children, onClick, disabled, active, aria }:
  { children?: React.ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean; aria?: string }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} aria-label={aria}
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        minWidth: 28, height: 28, padding: "0 7px", borderRadius: "var(--radius-sm)",
        border: `1px solid ${active ? "var(--brass-400)" : "var(--border-hair)"}`,
        background: active ? "var(--brass-100)" : (hover && !disabled ? "var(--bone-200)" : "var(--surface-card)"),
        color: disabled ? "var(--text-subtle)" : active ? "var(--brass-700)" : "var(--text-body)",
        fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: active ? 600 : 400,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
      {children}
    </button>
  );
}

function pageWindow(page: number, pageCount: number): (number | string)[] {
  const out: (number | string)[] = [];
  const near = (n: number) => n === 1 || n === pageCount || Math.abs(n - page) <= 1;
  let last = 0;
  for (let n = 1; n <= pageCount; n++) {
    if (near(n)) { if (last && n - last > 1) out.push("…"); out.push(n); last = n; }
  }
  return out;
}

export function Pager({ page, pageCount, total, from, to, onPage, unit = "item" }:
  { page: number; pageCount: number; total: number; from: number; to: number; onPage: (n: number) => void; unit?: string }) {
  if (total === 0) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      padding: "11px 14px", borderTop: "1px solid var(--border-hair)", background: "var(--bone-100)", flexWrap: "wrap",
    }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>
        {from}–{to} dari {total} {unit}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <PagerBtn onClick={() => onPage(page - 1)} disabled={page <= 1} aria="Sebelumnya">
          <Icon name="chevron-left" size={15} />
        </PagerBtn>
        {pageWindow(page, pageCount).map((n, i) => n === "…"
          ? <span key={"e" + i} style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)", padding: "0 2px" }}>…</span>
          : <PagerBtn key={n} onClick={() => onPage(n as number)} active={n === page} aria={"Halaman " + n}>{n}</PagerBtn>)}
        <PagerBtn onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria="Berikutnya">
          <Icon name="chevron-right" size={15} />
        </PagerBtn>
      </div>
    </div>
  );
}
