import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TerminalPane } from "../src/screens/TerminalPane";

// SPEC-511 · xterm butuh canvas + pengukuran font; jsdom tak punya keduanya. Yang diuji di sini
// bukan rendering terminalnya melainkan **kontrak call site**: opsi apa yang benar-benar sampai ke
// konstruktor `Terminal`. Itu tak bisa dijawab helper murni — `clipboardIntent` (SPEC-289) sudah
// benar sejak hari pertama dan salin tetap mati, karena `term.hasSelection()` selamanya `false`
// selagi tmux `mouse on` menyalakan mouse-reporting dan xterm karenanya mematikan SelectionService.
const xt = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  keyHandler: undefined as ((e: KeyboardEvent) => boolean) | undefined,
  selection: "",
  written: [] as string[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public cols = 80;
    public rows = 24;
    constructor(options: Record<string, unknown>) { xt.options = options; }
    public loadAddon(): void { }
    public open(): void { }
    public focus(): void { }
    public write(d: string): void { xt.written.push(d); }
    public dispose(): void { }
    public hasSelection(): boolean { return xt.selection.length > 0; }
    public getSelection(): string { return xt.selection; }
    public attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean): void { xt.keyHandler = fn; }
    public onData(): { dispose: () => void } { return { dispose: () => { } }; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { public fit(): void { } } }));

const sockets: { sent: string[]; readyState: number }[] = [];
class FakeWebSocket {
  public static readonly OPEN = 1;
  public readyState = 1;
  public sent: string[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) { sockets.push(this); }
  public send(m: string): void { this.sent.push(m); }
  public close(): void { this.readyState = 3; }
}

const keydown = (over: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ type: "keydown", metaKey: false, ctrlKey: false, shiftKey: false, ...over } as KeyboardEvent);

beforeEach(() => {
  xt.options = undefined; xt.keyHandler = undefined; xt.selection = ""; xt.written = [];
  sockets.length = 0;
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("ResizeObserver", class { observe(): void { } disconnect(): void { } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TerminalPane · seleksi & salin (SPEC-511)", () => {
  it("lahir dengan macOptionClickForcesSelection agar seleksi mungkin di bawah mouse-reporting tmux", () => {
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    // tmux `mouse on` (SPEC-209, terukur memancarkan ?1000h ?1002h ?1006h) membuat xterm memanggil
    // `SelectionService.disable()`. Di macOS satu-satunya jalan keluarnya `altKey &&
    // macOptionClickForcesSelection`, dan opsi itu default `false` — tanpa baris ini, drag polos
    // MAUPUN Option+drag sama-sama menghasilkan nol karakter (terukur di Chrome).
    expect(xt.options?.macOptionClickForcesSelection).toBe(true);
  });

  it("Cmd+C dengan seleksi menyalin isi seleksi dan tak meneruskan tombolnya ke TUI", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    xt.selection = "baris log yang diseleksi";
    const forwarded = xt.keyHandler?.(keydown({ key: "c", metaKey: true }));
    expect(writeText).toHaveBeenCalledWith("baris log yang diseleksi");
    expect(forwarded).toBe(false);
  });

  it("tanpa seleksi, Cmd+C diteruskan apa adanya — clipboard tak disentuh", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    xt.selection = "";
    expect(xt.keyHandler?.(keydown({ key: "c", metaKey: true }))).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });
});
