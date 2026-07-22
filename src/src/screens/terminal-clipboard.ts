// xterm.js merender seleksi sendiri (canvas), bukan seleksi native browser — jadi Cmd/Ctrl+C
// tidak menyalin apa pun kecuali app menyalinnya manual lewat `getSelection()` (per docs xterm).
// Helper murni ini memutuskan intent dari sebuah keydown; efek (clipboard read/write, kirim ke
// PTY) dilakukan pemanggil. Dipisah agar teruji tanpa canvas/jsdom.
export type ClipboardIntent = "copy" | "paste" | null;

type KeyLike = Pick<KeyboardEvent, "type" | "key" | "metaKey" | "ctrlKey" | "shiftKey">;

export function clipboardIntent(e: KeyLike, hasSelection: boolean): ClipboardIntent {
  if (e.type !== "keydown") return null;
  const k = e.key.toLowerCase();
  // Combo salin/tempel: Cmd (macOS) atau Ctrl+Shift (Windows/Linux). Ctrl polos SENGAJA
  // dilewatkan — Ctrl+C = SIGINT, Ctrl+V = literal — itu milik TUI, bukan clipboard.
  const combo = e.metaKey || (e.ctrlKey && e.shiftKey);
  if (!combo) return null;
  if (k === "c") return hasSelection ? "copy" : null;
  if (k === "v") return "paste";
  return null;
}
