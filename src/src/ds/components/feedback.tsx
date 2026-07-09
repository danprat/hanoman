// Ported verbatim from _ds_bundle.js (feedback/*). ESM + typed props;
// __ds_scope.Icon → imported Icon. No visual change.
import React from "react";
import { Icon } from "../icon";
const _extends = Object.assign;

type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";
type BadgeProps = { children?: React.ReactNode; tone?: Tone; icon?: string;
  variant?: "soft" | "solid" | "outline"; size?: "sm" | "md"; style?: React.CSSProperties } & Record<string, any>;

const BADGE_TONES: Record<string, { bg: string; fg: string; bd: string }> = {
  neutral: { bg: "var(--bone-200)", fg: "var(--ink-600)", bd: "var(--bone-400)" },
  brass: { bg: "var(--brass-100)", fg: "var(--brass-700)", bd: "var(--brass-300)" },
  info: { bg: "var(--wind-100)", fg: "var(--wind-700)", bd: "var(--wind-500)" },
  ok: { bg: "var(--status-ok-tint)", fg: "var(--leaf-600)", bd: "var(--leaf-500)" },
  warn: { bg: "var(--status-warn-tint)", fg: "var(--amber-600)", bd: "var(--amber-500)" },
  err: { bg: "var(--status-err-tint)", fg: "var(--clay-600)", bd: "var(--clay-500)" },
};
export function Badge({ children, tone = "neutral", icon, variant = "soft", size = "md", className = "", style = {}, ...rest }: BadgeProps) {
  const t = BADGE_TONES[tone] || BADGE_TONES.neutral!;
  const sm = size === "sm";
  const solid = variant === "solid";
  const outline = variant === "outline";
  return React.createElement("span", _extends({
    className,
    style: {
      display: "inline-flex", alignItems: "center", gap: sm ? 4 : 5, height: sm ? 18 : 22,
      padding: sm ? "0 7px" : "0 9px", borderRadius: "var(--radius-pill)", fontFamily: "var(--font-ui)",
      fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)", fontWeight: "var(--weight-medium)", lineHeight: 1,
      letterSpacing: "0.01em", background: solid ? t.fg : outline ? "transparent" : t.bg,
      color: solid ? "var(--bone-000)" : t.fg,
      border: `1px solid ${outline ? t.bd : solid ? t.fg : "transparent"}`, whiteSpace: "nowrap", ...style,
    },
  }, rest), icon && React.createElement(Icon, { name: icon, size: sm ? 11 : 13 }), children);
}

type CalloutProps = { children?: React.ReactNode; tone?: "info" | "ok" | "warn" | "err" | "brass";
  title?: React.ReactNode; icon?: string; action?: React.ReactNode; style?: React.CSSProperties } & Record<string, any>;
const CALLOUT_TONES: Record<string, { fg: string; bg: string; bd: string; icon: string }> = {
  info: { fg: "var(--wind-700)", bg: "var(--wind-050)", bd: "var(--wind-500)", icon: "info" },
  ok: { fg: "var(--leaf-600)", bg: "var(--leaf-100)", bd: "var(--leaf-500)", icon: "check-circle-2" },
  warn: { fg: "var(--amber-600)", bg: "var(--status-warn-tint)", bd: "var(--amber-500)", icon: "alert-triangle" },
  err: { fg: "var(--clay-600)", bg: "var(--status-err-tint)", bd: "var(--clay-500)", icon: "octagon-alert" },
  brass: { fg: "var(--brass-700)", bg: "var(--brass-050)", bd: "var(--brass-400)", icon: "sparkles" },
};
export function Callout({ children, tone = "info", title, icon, action, className = "", style = {}, ...rest }: CalloutProps) {
  const t = CALLOUT_TONES[tone] || CALLOUT_TONES.info!;
  return React.createElement("div", _extends({
    className, role: "note",
    style: { display: "flex", gap: 12, padding: "14px 16px", background: t.bg, border: `1px solid ${t.bd}`,
      borderLeft: `3px solid ${t.fg}`, borderRadius: "var(--radius-md)", ...style },
  }, rest),
    React.createElement(Icon, { name: icon || t.icon, size: 19, color: t.fg, style: { marginTop: 1 } }),
    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
      title && React.createElement("div", { style: { fontFamily: "var(--font-ui)", fontSize: "var(--text-md)",
        fontWeight: "var(--weight-semibold)", color: "var(--text-strong)", marginBottom: children ? 3 : 0 } }, title),
      children && React.createElement("div", { style: { fontSize: "var(--text-sm)", lineHeight: "var(--leading-normal)",
        color: "var(--text-body)" } }, children),
      action && React.createElement("div", { style: { marginTop: 10 } }, action)));
}

type ProgressProps = { value?: number; max?: number; tone?: "brass" | "ok" | "warn" | "err" | "info";
  size?: "sm" | "md" | "lg"; showLabel?: boolean; label?: React.ReactNode; style?: React.CSSProperties } & Record<string, any>;
const PROGRESS_TONES: Record<string, string> = { brass: "var(--accent)", ok: "var(--leaf-600)",
  warn: "var(--amber-600)", err: "var(--clay-600)", info: "var(--wind-600)" };
export function ProgressBar({ value = 0, max = 100, tone = "brass", size = "md", showLabel = false, label, className = "", style = {}, ...rest }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const h = size === "sm" ? 5 : size === "lg" ? 10 : 7;
  const color = PROGRESS_TONES[tone] || PROGRESS_TONES.brass!;
  return React.createElement("div", _extends({ className, style: { ...style } }, rest),
    (showLabel || label) && React.createElement("div", { style: { display: "flex", justifyContent: "space-between",
      alignItems: "baseline", marginBottom: 6 } },
      React.createElement("span", { style: { fontSize: "var(--text-sm)", color: "var(--text-body)" } }, label),
      showLabel && React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
        color: "var(--text-muted)" } }, Math.round(pct), "%")),
    React.createElement("div", { role: "progressbar", "aria-valuenow": value, "aria-valuemax": max,
      style: { height: h, background: "var(--bone-300)", borderRadius: "var(--radius-pill)", overflow: "hidden" } },
      React.createElement("div", { style: { width: pct + "%", height: "100%", background: color,
        borderRadius: "var(--radius-pill)", transition: "width var(--dur-slow) var(--ease-out)" } })));
}

type StatusPillProps = { status?: string; children?: React.ReactNode; size?: "sm" | "md"; style?: React.CSSProperties } & Record<string, any>;
const STATUS: Record<string, { label: string; color: string; bg: string; pulse: boolean }> = {
  ok: { label: "On convention", color: "var(--leaf-600)", bg: "var(--status-ok-tint)", pulse: false },
  drift: { label: "Drifting", color: "var(--amber-600)", bg: "var(--status-warn-tint)", pulse: false },
  broken: { label: "Off convention", color: "var(--clay-600)", bg: "var(--status-err-tint)", pulse: false },
  running: { label: "Running", color: "var(--brass-600)", bg: "var(--brass-100)", pulse: true },
  queued: { label: "Queued", color: "var(--wind-600)", bg: "var(--wind-100)", pulse: false },
  done: { label: "Done", color: "var(--leaf-600)", bg: "var(--status-ok-tint)", pulse: false },
  failed: { label: "Failed", color: "var(--clay-600)", bg: "var(--status-err-tint)", pulse: false },
  paused: { label: "Paused", color: "var(--amber-600)", bg: "var(--status-warn-tint)", pulse: false },
  stopped: { label: "Stopped", color: "var(--ink-500)", bg: "var(--bone-200)", pulse: false },
  scanning: { label: "Scanning", color: "var(--wind-600)", bg: "var(--wind-100)", pulse: true },
  idle: { label: "Idle", color: "var(--ink-500)", bg: "var(--bone-200)", pulse: false },
};
export function StatusPill({ status = "idle", children, size = "md", className = "", style = {}, ...rest }: StatusPillProps) {
  const s = STATUS[status] || STATUS.idle!;
  const sm = size === "sm";
  const dot = sm ? 6 : 7;
  return React.createElement("span", _extends({
    className,
    style: { display: "inline-flex", alignItems: "center", gap: sm ? 5 : 6, height: sm ? 20 : 24,
      padding: sm ? "0 8px 0 7px" : "0 10px 0 8px", borderRadius: "var(--radius-pill)", background: s.bg, color: s.color,
      fontFamily: "var(--font-ui)", fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)", fontWeight: "var(--weight-medium)",
      lineHeight: 1, whiteSpace: "nowrap", ...style },
  }, rest),
    React.createElement("span", { style: { width: dot, height: dot, borderRadius: "50%", background: s.color,
      flex: "0 0 auto", animation: s.pulse ? "hn-pulse 1.4s ease-in-out infinite" : "none" } }),
    children || s.label,
    React.createElement("style", null, `@keyframes hn-pulse{0%,100%{opacity:1}50%{opacity:.35}}`));
}

type TooltipProps = { content?: React.ReactNode; children?: React.ReactNode;
  placement?: "top" | "bottom" | "left" | "right"; style?: React.CSSProperties } & Record<string, any>;
export function Tooltip({ content, children, placement = "top", className = "", style = {}, ...rest }: TooltipProps) {
  const [show, setShow] = React.useState(false);
  const pos = ({
    top: { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    bottom: { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    left: { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
    right: { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
  } as Record<string, any>)[placement];
  return React.createElement("span", _extends({
    className, onMouseEnter: () => setShow(true), onMouseLeave: () => setShow(false),
    onFocus: () => setShow(true), onBlur: () => setShow(false),
    style: { position: "relative", display: "inline-flex", ...style },
  }, rest), children,
    React.createElement("span", { role: "tooltip", style: { position: "absolute", zIndex: 40, ...pos,
      padding: "5px 9px", background: "var(--ink-900)", color: "var(--bone-100)", fontFamily: "var(--font-ui)",
      fontSize: "var(--text-xs)", lineHeight: 1.3, fontWeight: "var(--weight-medium)", borderRadius: "var(--radius-sm)",
      boxShadow: "var(--shadow-lg)", whiteSpace: "nowrap", pointerEvents: "none", opacity: show ? 1 : 0,
      transform: `${pos.transform} translateY(${show ? "0" : placement === "top" ? "2px" : "-2px"})`,
      transition: "opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)" } }, content));
}
