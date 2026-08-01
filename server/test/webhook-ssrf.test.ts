import { describe, it, expect } from "vitest";
import {
  validateWebhookUrl, isBlockedAddress, checkDestination, checkUrlShape,
} from "../src/services/webhooks/ssrf";

describe("validateWebhookUrl", () => {
  it("menerima http & https", () => {
    expect(validateWebhookUrl("https://contoh.id/hook").ok).toBe(true);
    expect(validateWebhookUrl("http://contoh.id/hook").ok).toBe(true);
  });
  it("menolak skema selain http(s)", () => {
    for (const u of ["file:///etc/passwd", "ftp://a.b/c", "gopher://a.b", "javascript:alert(1)"])
      expect(validateWebhookUrl(u).ok, u).toBe(false);
  });
  it("menolak kredensial di URL (bocor ke log proxy)", () => {
    expect(validateWebhookUrl("https://user:pw@contoh.id/hook").ok).toBe(false);
  });
  it("menolak sampah yang bukan URL", () => {
    expect(validateWebhookUrl("bukan url").ok).toBe(false);
    expect(validateWebhookUrl("").ok).toBe(false);
  });
});

describe("isBlockedAddress", () => {
  it("memblokir loopback, private, link-local, ULA, multicast, unspecified", () => {
    for (const ip of [
      "127.0.0.1", "127.9.9.9", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1",
      "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
    ]) expect(isBlockedAddress(ip), ip).toBe(true);
  });
  it("meloloskan alamat publik", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2001:4860:4860::8888"])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });
});

describe("checkDestination", () => {
  const lookup = (addr: string) => async () => [{ address: addr }];
  it("menolak host yang resolve ke alamat internal", async () => {
    const r = await checkDestination(new URL("https://jebakan.id/h"), false, lookup("127.0.0.1"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("internal");
  });
  it("mengizinkannya saat allowPrivate dinyalakan eksplisit", async () => {
    expect((await checkDestination(new URL("http://localhost:9000/h"), true, lookup("127.0.0.1"))).ok)
      .toBe(true);
  });
  it("meloloskan alamat publik", async () => {
    expect((await checkDestination(new URL("https://contoh.id/h"), false, lookup("93.184.216.34"))).ok)
      .toBe(true);
  });
  it("menolak bila SATU dari beberapa alamat internal (jangan ambil yang pertama saja)", async () => {
    const many = async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }];
    expect((await checkDestination(new URL("https://contoh.id/h"), false, many)).ok).toBe(false);
  });
  it("gagal-tertutup saat DNS tak bisa menjawab", async () => {
    const boom = async () => { throw new Error("ENOTFOUND"); };
    const r = await checkDestination(new URL("https://hantu.id/h"), false, boom);
    expect(r.ok).toBe(false);
  });
});

describe("checkUrlShape (gerbang saat SIMPAN)", () => {
  it("meloloskan hostname biasa TANPA menyentuh DNS", () => {
    // Penting: pendaftaran endpoint tak boleh gagal saat DNS lambat/mati. Gerbang sungguhannya
    // `checkDestination`, yang jalan tiap percobaan kirim.
    expect(checkUrlShape("https://contoh.id/hook", false).ok).toBe(true);
    expect(checkUrlShape("https://hostname-yang-belum-ada-9f2c.id/h", false).ok).toBe(true);
  });
  it("menolak IP literal internal", () => {
    for (const u of ["http://127.0.0.1:9000/h", "http://10.0.0.5/h", "http://169.254.169.254/latest",
      "http://[::1]:9000/h"]) {
      const r = checkUrlShape(u, false);
      expect(r.ok, u).toBe(false);
      if (!r.ok) expect(r.error).toContain("internal");
    }
  });
  it("menolak localhost meski bukan IP literal", () => {
    expect(checkUrlShape("http://localhost:9000/h", false).ok).toBe(false);
    expect(checkUrlShape("http://api.localhost/h", false).ok).toBe(false);
  });
  it("allowPrivate membuka semuanya", () => {
    expect(checkUrlShape("http://127.0.0.1:9000/h", true).ok).toBe(true);
    expect(checkUrlShape("http://localhost:9000/h", true).ok).toBe(true);
  });
  it("tetap menolak bentuk URL yang salah walau allowPrivate", () => {
    expect(checkUrlShape("file:///etc/passwd", true).ok).toBe(false);
  });
});
