import { EventEmitter } from "node:events";
import { prisma } from "../db";
import { runOne, SteerQueue, type RunDeps, type RunEvent, type RunInput } from "@hanoman/runner";
import { prodDeps } from "./deps";
type Live = { abortController: AbortController; steer: SteerQueue; log: { t: string; s: string }[]; pending: Promise<void> };
export class RunManager {
  private live = new Map<string, Live>();
  // Event buses are keyed separately from Live so a subscriber can attach
  // BEFORE start() creates the run's live state (dashboard opens the SSE stream
  // before the run is dequeued).
  private buses = new Map<string, EventEmitter>();
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(private maxConcurrent = 3) {}
  private busFor(runId: string) {
    let e = this.buses.get(runId);
    if (!e) { e = new EventEmitter(); e.setMaxListeners(0); this.buses.set(runId, e); }
    return e;
  }
  subscribe(runId: string, cb: (e: RunEvent) => void) {
    const e = this.busFor(runId); e.on("event", cb);
    return () => e.off("event", cb);
  }
  logSnapshot(runId: string) { return this.live.get(runId)?.log ?? []; }
  steer(runId: string, message: string) { this.live.get(runId)?.steer.push(message); }
  control(runId: string, action: "pause" | "resume" | "stop" | "retry") {
    const l = this.live.get(runId); if (!l) return;
    if (action === "pause" || action === "stop") l.abortController.abort();
    // resume/retry re-enqueue a fresh run (handled by the route via start()).
  }
  private async persist(runId: string, e: RunEvent, l: Live) {
    if (e.kind === "log") { l.log.push(e.line); await prisma.run.update({ where: { id: runId }, data: { log: l.log as any } }); }
    else if (e.kind === "status") await prisma.run.update({ where: { id: runId }, data: { status: e.status } });
    else if (e.kind === "phase") {
      const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
      const phases = (run.phases as any[]).map((p) => p.name === e.name ? { ...p, state: e.state } : p);
      await prisma.run.update({ where: { id: runId }, data: { phases } });
    } else if (e.kind === "cost") await prisma.run.update({ where: { id: runId }, data: { tokensIn: String(e.tokensIn), tokensOut: String(e.tokensOut), cost: `$${e.costUsd.toFixed(2)}` } });
    else if (e.kind === "file") { const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } }); await prisma.run.update({ where: { id: runId }, data: { files: [...(run.files as any[]), e] } }); }
  }
  async start(input: RunInput, deps: RunDeps = prodDeps) {
    // ponytail: in-process semaphore; real durable queueing is SPEC-004.
    await new Promise<void>((res) => { if (this.running < this.maxConcurrent) res(); else this.queue.push(res); });
    this.running++;
    const l: Live = { abortController: new AbortController(), steer: new SteerQueue("mulai"), log: [], pending: Promise.resolve() };
    this.live.set(input.runId, l);
    const bus = this.busFor(input.runId);
    // Persists are chained (serialized) so read-modify-write events (phase/file)
    // can't race, and awaited in finally so the final status lands before start() resolves.
    const onEvent = (e: RunEvent) => {
      l.pending = l.pending.then(() => this.persist(input.runId, e, l)).catch((err) => { console.error(`persist ${input.runId}`, err); });
      bus.emit("event", e);
    };
    try { await runOne(input, deps, onEvent, { abortController: l.abortController, steer: l.steer }); }
    finally { await l.pending; this.running--; this.queue.shift()?.(); }
  }
}
export const runManager = new RunManager();
