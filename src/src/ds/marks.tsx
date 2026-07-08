/* Ported from .prototype/app/marks.jsx — Hanoman brand marks as SVG.
   Each inherits currentColor. No visual change. */
import type React from "react";

const MARK_VB = "0 0 128 128";
const R = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

function MarkCincin() {
  return (
    <svg viewBox={MARK_VB} width="100%" height="100%">
      <circle cx="64" cy="64" r="27" {...R} strokeWidth="2.4" opacity="0.4" />
      <circle cx="64" cy="64" r="40" {...R} strokeWidth="9" />
      <circle cx="64" cy="24" r="8.5" fill="currentColor" />
    </svg>
  );
}
function MarkBayu() {
  return (
    <svg viewBox={MARK_VB} width="100%" height="100%">
      <path {...R} strokeWidth="9" d="M32 44 H72 a12 12 0 1 0 -12 -12" />
      <path {...R} strokeWidth="9" d="M24 66 H84 a13 13 0 1 0 -13 -13" />
      <path {...R} strokeWidth="9" d="M38 88 H68 a10 10 0 1 0 -10 -10" />
    </svg>
  );
}
function taperedSpiralPath({ cx = 65, cy = 66, turns = 1.32, rOuter = 41, rInner = 5,
  wBase = 21, wTip = 2, a0 = 0.15, dir = 1, N = 160 } = {}) {
  const pts: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = rOuter + (rInner - rOuter) * t;
    const a = a0 + dir * turns * 2 * Math.PI * t;
    pts.push({ x: cx + r * Math.sin(a), y: cy + r * Math.cos(a), t });
  }
  const hw = (t: number) => (wBase + (wTip - wBase) * t) / 2;
  const outer: { x: number; y: number }[] = [], inner: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[Math.max(0, i - 1)]!, next = pts[Math.min(pts.length - 1, i + 1)]!;
    let tx = next.x - prev.x, ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
    const nx = -ty, ny = tx, w = hw(p.t);
    outer.push({ x: p.x + nx * w, y: p.y + ny * w });
    inner.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  const f = (n: number) => n.toFixed(2);
  let d = "M " + f(outer[0]!.x) + " " + f(outer[0]!.y);
  for (let i = 1; i < outer.length; i++) d += " L " + f(outer[i]!.x) + " " + f(outer[i]!.y);
  for (let i = inner.length - 1; i >= 0; i--) d += " L " + f(inner[i]!.x) + " " + f(inner[i]!.y);
  d += " A " + f(wBase / 2) + " " + f(wBase / 2) + " 0 0 1 " + f(outer[0]!.x) + " " + f(outer[0]!.y) + " Z";
  return d;
}
const HN_BUNTUT_D = taperedSpiralPath({});
function MarkBuntut() {
  return (
    <svg viewBox={MARK_VB} width="100%" height="100%">
      <path d={HN_BUNTUT_D} fill="currentColor" stroke="none" />
    </svg>
  );
}
function MarkAnoman() {
  return (
    <svg viewBox={MARK_VB} width="100%" height="100%">
      <path {...R} strokeWidth="11" d="M46 24 V102" />
      <path {...R} strokeWidth="11" d="M46 64 C 46 50 58 46 71 46 C 83 46 86 57 86 68 V 88 c 0 9 9 12 17 7" />
    </svg>
  );
}
function MarkDronagiri() {
  return (
    <svg viewBox={MARK_VB} width="100%" height="100%">
      <path {...R} strokeWidth="9" d="M26 94 L64 42 L102 94" />
      <path {...R} strokeWidth="9" d="M52 94 L70 68" opacity="0.4" />
      <circle cx="64" cy="34" r="8" fill="currentColor" />
    </svg>
  );
}
export const HN_MARKS: Record<string, () => React.ReactElement> = {
  cincin: MarkCincin, bayu: MarkBayu, buntut: MarkBuntut, anoman: MarkAnoman, dronagiri: MarkDronagiri,
};
export function Mark({ id, size = 128, color = "var(--brass-500)", style = {} }:
  { id: string; size?: number; color?: string; style?: React.CSSProperties }) {
  const Cmp = HN_MARKS[id];
  return <span style={{ display: "inline-flex", width: size, height: size, color, flex: "0 0 auto", ...style }}>{Cmp ? <Cmp /> : null}</span>;
}
export function Wordmark({ size = 30, color = "var(--ink-900)", weight = 500, style = {} }:
  { size?: number; color?: string; weight?: number; style?: React.CSSProperties }) {
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: size, fontWeight: weight,
      letterSpacing: "-0.02em", color, lineHeight: 1, whiteSpace: "nowrap", ...style }}>hanoman</span>
  );
}
