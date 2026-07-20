import { describe, it, expect } from "vitest";
import { saveUpload, readUpload, deleteUpload, extFor } from "./uploads";

describe("uploads", () => {
  it("extFor memetakan mime gambar", () => {
    expect(extFor("image/png")).toBe(".png");
    expect(extFor("image/jpeg")).toBe(".jpg");
    expect(extFor("image/webp")).toBe(".webp");
    expect(extFor("application/zip")).toBe(".bin");
  });
  it("save → read → delete round-trip", async () => {
    const buf = Buffer.from("PNGDATA");
    const { storageKey, size } = await saveUpload(buf, "image/png");
    expect(size).toBe(buf.length);
    expect(storageKey.endsWith(".png")).toBe(true);
    expect((await readUpload(storageKey)).equals(buf)).toBe(true);
    await deleteUpload(storageKey);
    await expect(readUpload(storageKey)).rejects.toThrow();
  });
});
