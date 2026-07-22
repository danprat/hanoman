import { describe, it, expect } from "vitest";
import { clipboardIntent } from "../src/screens/terminal-clipboard";

const key = (over: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ type: "keydown", metaKey: false, ctrlKey: false, shiftKey: false, ...over } as KeyboardEvent);

describe("clipboardIntent", () => {
  it("Cmd+C copies when there is a selection (macOS)", () => {
    expect(clipboardIntent(key({ key: "c", metaKey: true }), true)).toBe("copy");
  });

  it("Cmd+C does nothing without a selection", () => {
    expect(clipboardIntent(key({ key: "c", metaKey: true }), false)).toBeNull();
  });

  it("Ctrl+Shift+C copies when there is a selection (Windows/Linux)", () => {
    expect(clipboardIntent(key({ key: "C", ctrlKey: true, shiftKey: true }), true)).toBe("copy");
  });

  it("plain Ctrl+C is left to the terminal (SIGINT), never hijacked as copy", () => {
    expect(clipboardIntent(key({ key: "c", ctrlKey: true }), true)).toBeNull();
  });

  it("Cmd+V pastes (macOS)", () => {
    expect(clipboardIntent(key({ key: "v", metaKey: true }), false)).toBe("paste");
  });

  it("Ctrl+Shift+V pastes (Windows/Linux)", () => {
    expect(clipboardIntent(key({ key: "V", ctrlKey: true, shiftKey: true }), false)).toBe("paste");
  });

  it("plain Ctrl+V is left to the terminal, never hijacked as paste", () => {
    expect(clipboardIntent(key({ key: "v", ctrlKey: true }), false)).toBeNull();
  });

  it("ignores keyup so only one action fires per keystroke", () => {
    expect(clipboardIntent(key({ key: "c", metaKey: true, type: "keyup" }), true)).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(clipboardIntent(key({ key: "a", metaKey: true }), true)).toBeNull();
  });
});
