import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signBody, signedHeaders } from "../src/services/webhooks/sign";

describe("signBody", () => {
  // Vektor tetap: kalau format berubah, SEMUA penerima yang sudah berjalan patah tanpa suara.
  it("HMAC-SHA256 atas `<timestamp>.<body>` berprefix v1=", () => {
    const secret = "rahasia-uji-32-byte-atau-lebih!!";
    const body = '{"a":1}';
    const ts = 1785318082;
    const want = "v1=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    expect(signBody(secret, ts, body)).toBe(want);
  });

  it("berubah bila timestamp berubah (anti-replay bermakna)", () => {
    expect(signBody("s".repeat(32), 1, "{}")).not.toBe(signBody("s".repeat(32), 2, "{}"));
  });
});

describe("signedHeaders", () => {
  it("memuat seluruh header kontrak dan TIDAK memuat secret", () => {
    const h = signedHeaders({
      secret: "s".repeat(32), body: "{}", eventType: "spec.created",
      eventId: "evt_1", deliveryId: "dlv_1", attempt: 2, nowSec: 1785318082,
    });
    expect(h["X-Hanoman-Event"]).toBe("spec.created");
    expect(h["X-Hanoman-Event-Id"]).toBe("evt_1");
    expect(h["X-Hanoman-Delivery"]).toBe("dlv_1");
    expect(h["X-Hanoman-Attempt"]).toBe("2");
    expect(h["X-Hanoman-Timestamp"]).toBe("1785318082");
    expect(h["X-Hanoman-Signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(h["Content-Type"]).toBe("application/json");
    expect(JSON.stringify(h)).not.toContain("s".repeat(32));
  });
});
