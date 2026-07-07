/* marks.jsx — the candidate Hanoman logo marks, drawn as clean
   geometric SVG on a 128×128 grid. Every mark inherits `currentColor`
   so the same component renders brass-on-bone, ink-on-brass, or
   brass-on-ink just by setting the wrapper's color. No gradients,
   no illustration — hairline-and-solid, in the editorial spirit. */

const MARK_VB = "0 0 128 128";
const R = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" };

/* 01 · Cincin — the signet ring. Rama's ring: a closed, unbroken
   circle (eternal) set with a single stone (proof/seal). */
function MarkCincin() {
  return (
    <svg viewBox={MARK_VB} width="100%" height="100%">
      <circle cx="64" cy="64" r="27" {...R} strokeWidth="2.4" opacity="0.4" />
      <circle cx="64" cy="64" r="40" {...R} strokeWidth="9" />
      <circle cx="64" cy="24" r="8.5" fill="currentColor" />
    </svg>
  );
}

/* 02 · Bayu — son of the wind. Three gusts flowing right, each
   hooking into a curl. The lineage mark. */
function MarkBayu() {
  return (
    <svg viewBox={MARK_VB} width="100%" height="100%">
      <path {...R} strokeWidth="9" d="M32 44 H72 a12 12 0 1 0 -12 -12" />
      <path {...R} strokeWidth="9" d="M24 66 H84 a13 13 0 1 0 -13 -13" />
      <path {...R} strokeWidth="9" d="M38 88 H68 a10 10 0 1 0 -10 -10" />
    </svg>
  );
}

/* 03 · Buntut — the coiled tail (Anoman Obong). A tapered spiral:
   thick, rounded at the root; thinning as it coils inward to a fine
   tip. Generated so the taper stays true at any size. */
function taperedSpiralPath({ cx = 65, cy = 66, turns = 1.32, rOuter = 41, rInner = 5,
                             wBase = 21, wTip = 2, a0 = 0.15, dir = 1, N = 160 }) {
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = rOuter + (rInner - rOuter) * t;
    const a = a0 + dir * turns * 2 * Math.PI * t;
    pts.push({ x: cx + r * Math.sin(a), y: cy + r * Math.cos(a), t });
  }
  const hw = (t) => (wBase + (wTip - wBase) * t) / 2;
  const outer = [], inner = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x, ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
    const nx = -ty, ny = tx, w = hw(p.t);
    outer.push({ x: p.x + nx * w, y: p.y + ny * w });
    inner.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  const f = (n) => n.toFixed(2);
  let d = "M " + f(outer[0].x) + " " + f(outer[0].y);
  for (let i = 1; i < outer.length; i++) d += " L " + f(outer[i].x) + " " + f(outer[i].y);
  for (let i = inner.length - 1; i >= 0; i--) d += " L " + f(inner[i].x) + " " + f(inner[i].y);
  d += " A " + f(wBase / 2) + " " + f(wBase / 2) + " 0 0 1 " + f(outer[0].x) + " " + f(outer[0].y) + " Z";
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

/* 04 · Anoman — the lowercase h of the wordmark, its right leg
   curling off into wind. Ties the mark to the name. */
function MarkAnoman() {
  return (
    <svg viewBox={MARK_VB} width="100%" height="100%">
      <path {...R} strokeWidth="11" d="M46 24 V102" />
      <path {...R} strokeWidth="11" d="M46 64 C 46 50 58 46 71 46 C 83 46 86 57 86 68 V 88 c 0 9 9 12 17 7" />
    </svg>
  );
}

/* 05 · Dronagiri — carry the whole mountain. A summit with the one
   stone set at its peak: document everything to be sure. */
function MarkDronagiri() {
  return (
    <svg viewBox={MARK_VB} width="100%" height="100%">
      <path {...R} strokeWidth="9" d="M26 94 L64 42 L102 94" />
      <path {...R} strokeWidth="9" d="M52 94 L70 68" opacity="0.4" />
      <circle cx="64" cy="34" r="8" fill="currentColor" />
    </svg>
  );
}

const HN_MARKS = {
  cincin: MarkCincin, bayu: MarkBayu, buntut: MarkBuntut,
  anoman: MarkAnoman, dronagiri: MarkDronagiri,
};

/* Sized wrapper — sets the box + ink color; the SVG fills it. */
function Mark({ id, size = 128, color = "var(--brass-500)", style = {} }) {
  const Cmp = HN_MARKS[id];
  return (
    <span style={{ display: "inline-flex", width: size, height: size, color, flex: "0 0 auto", ...style }}>
      {Cmp ? <Cmp /> : null}
    </span>
  );
}

/* The wordmark — lowercase IBM Plex Mono, tight. */
function Wordmark({ size = 30, color = "var(--ink-900)", weight = 500, style = {} }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: size, fontWeight: weight,
      letterSpacing: "-0.02em", color, lineHeight: 1, whiteSpace: "nowrap", ...style,
    }}>hanoman</span>
  );
}

Object.assign(window, { Mark, Wordmark, HN_MARKS });
