import { describe, it, expect, vi } from "vitest";
import { saveUpload, readUpload, deleteUpload, extFor, readUploadOrFetch } from "./uploads";

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

  it("readUploadOrFetch: hit lokal mengembalikan file tanpa fetch", async () => {
    const { storageKey } = await saveUpload(Buffer.from("LOCAL"), "image/png");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await readUploadOrFetch(storageKey)).equals(Buffer.from("LOCAL"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await deleteUpload(storageKey);
  });

  it("readUploadOrFetch: miss tanpa SYNC_SERVER_URL → throw", async () => {
    delete process.env.SYNC_SERVER_URL; delete process.env.SYNC_DEVICE_TOKEN;
    await expect(readUploadOrFetch("hilang.png")).rejects.toThrow();
  });

  it("readUploadOrFetch: miss + client sync → tarik dari hub lalu cache", async () => {
    process.env.SYNC_SERVER_URL = "https://hub.example";
    process.env.SYNC_DEVICE_TOKEN = "tok";
    const key = "fetched-abc.png";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from("REMOTE"), { status: 200, headers: { "content-type": "image/png" } }),
    );
    const buf = await readUploadOrFetch(key);
    expect(buf.equals(Buffer.from("REMOTE"))).toBe(true);
    // dipanggil ke endpoint hub dengan Bearer
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://hub.example/api/sync/attachments/fetched-abc.png");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer tok" });
    // ter-cache: baca kedua tak fetch lagi
    fetchSpy.mockClear();
    expect((await readUploadOrFetch(key)).equals(Buffer.from("REMOTE"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await deleteUpload(key);
    delete process.env.SYNC_SERVER_URL; delete process.env.SYNC_DEVICE_TOKEN;
  });
});
