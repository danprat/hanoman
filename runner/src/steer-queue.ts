import type { SdkUserMessage } from "./types";
export class SteerQueue {
  private buf: string[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  constructor(initial?: string) { if (initial) this.buf.push(initial); }
  push(text: string) { this.buf.push(text); this.wake?.(); this.wake = null; }
  close() { this.closed = true; this.wake?.(); this.wake = null; }
  async *stream(): AsyncGenerator<SdkUserMessage> {
    while (true) {
      while (this.buf.length) {
        yield { type: "user", message: { role: "user", content: this.buf.shift()! } };
      }
      if (this.closed) return;
      await new Promise<void>((res) => { this.wake = res; });
    }
  }
}
