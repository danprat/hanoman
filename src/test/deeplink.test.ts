import { describe, it, expect } from "vitest";
import { parseSpecHash, specDeepLink } from "../src/screens/deeplink";

describe("parseSpecHash", () => {
  it("hash #spec=SPEC-9 → SPEC-9", () => expect(parseSpecHash("#spec=SPEC-9")).toBe("SPEC-9"));
  it("hash kombinasi #a=1&spec=SPEC-9 → SPEC-9", () => expect(parseSpecHash("#a=1&spec=SPEC-9")).toBe("SPEC-9"));
  it("URL-encoded didekode", () => expect(parseSpecHash("#spec=SPEC%2D9")).toBe("SPEC-9"));
  it("tanpa spec → null", () => expect(parseSpecHash("#foo=bar")).toBe(null));
  it("hash kosong → null", () => expect(parseSpecHash("")).toBe(null));
});

describe("specDeepLink", () => {
  it("bangun URL absolut #spec=", () =>
    expect(specDeepLink("SPEC-9", { origin: "https://h.id", pathname: "/" })).toBe("https://h.id/#spec=SPEC-9"));
  it("roundtrip parse", () =>
    expect(parseSpecHash(new URL(specDeepLink("SPEC-9", { origin: "https://h.id", pathname: "/" })).hash)).toBe("SPEC-9"));
});
