// SPEC-276 · ADR-0070 · symbolication server-side: frame minified → posisi sumber + context lines.
// Gotcha: stack V8 pakai kolom 1-based; source-map spec 0-based → kurangi 1 sebelum lookup.
import { TraceMap, originalPositionFor, sourceContentFor } from "@jridgewell/trace-mapping";
import type { SymbolicatedFrame } from "@hanoman/shared";

export type FrameLike = { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean };
export type MapLookup = (frameFilename: string) => string | null | Promise<string | null>;

const CONTEXT = 3;

export async function symbolicateFrames(frames: FrameLike[], lookup: MapLookup): Promise<SymbolicatedFrame[]> {
  const cache = new Map<string, TraceMap | null>();
  const out: SymbolicatedFrame[] = [];
  for (const f of frames) {
    const base: SymbolicatedFrame = { ...f, symbolicated: false };
    if (!f.filename || !f.lineno) { out.push(base); continue; }
    let tracer = cache.get(f.filename);
    if (tracer === undefined) {
      const text = await lookup(f.filename);
      try { tracer = text ? new TraceMap(text) : null; } catch { tracer = null; }
      cache.set(f.filename, tracer);
    }
    if (!tracer) { out.push(base); continue; }
    try {
      const pos = originalPositionFor(tracer, { line: f.lineno, column: (f.colno ?? 1) - 1 });
      if (pos.source == null || pos.line == null) { out.push(base); continue; }
      const content = sourceContentFor(tracer, pos.source);
      let contextLine: string | undefined, preContext: string[] | undefined, postContext: string[] | undefined;
      if (content != null) {
        const lines = content.split("\n");
        const idx = pos.line - 1; // pos.line 1-based
        contextLine = lines[idx];
        preContext = lines.slice(Math.max(0, idx - CONTEXT), idx);
        postContext = lines.slice(idx + 1, idx + 1 + CONTEXT);
      }
      out.push({
        ...f,
        function: pos.name ?? f.function,
        source: pos.source,
        sourceLine: pos.line,
        sourceColumn: pos.column ?? undefined,
        in_app: !/node_modules/.test(pos.source),
        contextLine, preContext, postContext,
        symbolicated: true,
      });
    } catch { out.push(base); }
  }
  return out;
}
