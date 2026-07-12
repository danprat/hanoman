export function coverageOf(docs: { category: string; linked: boolean }[]): number {
  const byCat = new Map<string, boolean>();
  for (const d of docs) byCat.set(d.category, (byCat.get(d.category) ?? true) && d.linked);
  if (byCat.size === 0) return 0;
  const linked = [...byCat.values()].filter(Boolean).length;
  return Math.round((linked / byCat.size) * 100);
}
export function docStatusFor(pct: number): "ok" | "drift" | "broken" {
  return pct >= 90 ? "ok" : pct >= 60 ? "drift" : "broken";
}

const LINK_RE = /\]\(([^)]+)\)/g;

function isExternalLink(target: string): boolean {
  return !target || /^(https?:|#|mailto:)/.test(target);
}

// Resolve a Markdown link target found inside `fromRel` to a repo-relative posix path.
export function resolveLink(fromRel: string, target: string): string {
  // SPEC-197 · link bertitel `[x](a.md "judul")` → ambil token pertama sebelum spasi; `#anchor` dibuang.
  const clean = target.trim().split(/\s+/)[0]!.split("#")[0]!.split("\\").join("/");
  if (!clean) return "";
  // Absolut dari root repo (`/internal/docs/x.md`) → root-relative; jangan gabung ke dir sumber.
  if (clean.startsWith("/")) return clean.slice(1).split("/").filter((p) => p && p !== ".").join("/");
  const dir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
  const parts = (dir ? dir.split("/") : []).concat(clean.replace(/^\.\//, "").split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

// BFS over the Markdown link graph from `indexRel`. Returns the subset of `docs`
// transitively reachable. `read(rel)` returns file contents or null. Pure — no fs.
export function linkedSetFrom(
  indexRel: string,
  docs: string[],
  read: (rel: string) => string | null,
): Set<string> {
  const inCorpus = new Set(docs);
  const seen = new Set<string>();
  // SPEC-197 · index pointer, bukan queue.shift() (O(n) tiap langkah → O(n²) total).
  const queue = [indexRel];
  let i = 0;
  while (i < queue.length) {
    const cur = queue[i++]!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const md = read(cur);
    if (md === null) continue;
    for (const m of md.matchAll(LINK_RE)) {
      const target = m[1]!.trim();
      if (isExternalLink(target)) continue;
      const rel = resolveLink(cur, target);
      if (rel && inCorpus.has(rel) && !seen.has(rel)) queue.push(rel);
    }
  }
  return new Set([...seen].filter((p) => inCorpus.has(p)));
}
