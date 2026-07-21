// hanoman-sdk stack parsing — dependency-free, isomorphic. Ubah stack string → frame terstruktur.
export type Frame = { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean };

// Lokasi "file:line:col" bisa berupa path OS, URL, atau "<anonymous>". Ambil trailing :line:col.
function splitLoc(loc: string): { filename?: string; lineno?: number; colno?: number } {
  const m = loc.match(/^(.*?):(\d+):(\d+)$/);
  if (!m) return { filename: loc || undefined };
  return { filename: m[1] || undefined, lineno: Number(m[2]), colno: Number(m[3]) };
}

export function parseStack(stack?: string): Frame[] {
  if (!stack) return [];
  const out: Frame[] = [];
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    // V8: "at fn (loc)"  |  "at loc"
    if (line.startsWith("at ")) {
      const body = line.slice(3).trim();
      const paren = body.match(/^(.*?)\s+\((.*)\)$/);
      if (paren) out.push({ function: paren[1] || undefined, ...splitLoc(paren[2] ?? "") });
      else out.push({ function: undefined, ...splitLoc(body) });
      continue;
    }
    // Firefox/Safari: "fn@loc"  |  "@loc"
    const at = line.match(/^([^@]*)@(.+)$/);
    if (at) out.push({ function: at[1] || undefined, ...splitLoc(at[2] ?? "") });
  }
  return out;
}

export function inApp(filename?: string): boolean {
  if (!filename) return false;
  if (filename.startsWith("node:")) return false;
  if (/[/\\]node_modules[/\\]/.test(filename)) return false;
  return true;
}

export function framesFromStack(stack?: string): Frame[] {
  return parseStack(stack).map((f) => ({ ...f, in_app: inApp(f.filename) }));
}

export function collectStack(err: unknown, maxDepth = 5): string | undefined {
  const seen = new Set<unknown>();
  let cur = err as { stack?: string; message?: string; name?: string; cause?: unknown } | undefined;
  let out: string | undefined;
  for (let d = 0; d < maxDepth && cur && !seen.has(cur); d++) {
    seen.add(cur);
    const piece = typeof cur.stack === "string" && cur.stack
      ? cur.stack
      : cur.message ? `${cur.name || "Error"}: ${cur.message}` : "";
    if (piece) out = out === undefined ? piece : `${out}\nCaused by: ${piece}`;
    cur = cur.cause as typeof cur;
  }
  return out;
}
