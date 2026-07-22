// SPEC-294 · ADR-0072 · registry source in-memory + jam cadence. Daun (backlog/errors/triase)
// memanggil registerSchedulerSource saat boot (diimport server.ts). lastRun reset saat restart →
// satu boot-pass (cermin vps-monitor). Cadence disimpan di Setting; jam "kapan terakhir" cukup RAM.
export type SchedulerSource = { id: string; check: () => Promise<void> };

const sources = new Map<string, SchedulerSource>();
const lastRun = new Map<string, number>();

export function registerSchedulerSource(s: SchedulerSource): void { sources.set(s.id, s); }
export function listSources(): SchedulerSource[] { return [...sources.values()]; }
export function clearSources(): void { sources.clear(); lastRun.clear(); } // test-only reset

export function getLastRun(id: string): number | undefined { return lastRun.get(id); }
export function setLastRun(id: string, t: number): void { lastRun.set(id, t); }
export function isDue(id: string, everyMin: number, now: number): boolean {
  const last = lastRun.get(id);
  return last === undefined || now - last >= everyMin * 60_000;
}
