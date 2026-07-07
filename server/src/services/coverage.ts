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
