import { describe, expect, it } from "vitest";
import {
  PRIORITY_ENUM, SOURCE_ENUM, SEVERITY_ENUM, STAGE_ENUM,
  BRIEF_PAYLOAD, QA_PAYLOAD, GOAL_PAYLOAD, SOURCE_PAYLOAD_ALLOF, PAGE_PARAMS, obj, str,
} from "./mcp-schema";
import { zSpecSource, zPriority, zStage } from "./enums";

describe("mcp-schema", () => {
  it("enum-nya diturunkan dari sumber yang sama dengan zod, bukan disalin tangan", () => {
    expect(SOURCE_ENUM).toEqual(zSpecSource.options);
    expect(PRIORITY_ENUM).toEqual(zPriority.options);
    expect(STAGE_ENUM).toEqual(zStage.options);
    expect(SOURCE_ENUM).not.toContain("cross-audit"); // dicabut SPEC-384/ADR-0092
    expect(SEVERITY_ENUM).toEqual(["critical", "major", "minor"]);
  });

  it("tiap payload menutup dirinya (additionalProperties:false) supaya oneOf hanya cocok satu", () => {
    for (const p of [BRIEF_PAYLOAD, QA_PAYLOAD, GOAL_PAYLOAD]) {
      expect(p.additionalProperties).toBe(false);
      expect(p.required?.length).toBeGreaterThan(0);
    }
    expect(Object.keys(QA_PAYLOAD.properties)).toContain("severity");
    expect(Object.keys(GOAL_PAYLOAD.properties)).toContain("goal");
    expect(Object.keys(BRIEF_PAYLOAD.properties)).toContain("outcome");
  });

  it("mengikat source ke bentuk payload lewat allOf if/then — ketiga arah", () => {
    expect(SOURCE_PAYLOAD_ALLOF).toHaveLength(3);
    const branches = SOURCE_PAYLOAD_ALLOF.map((b) => JSON.stringify(b.if));
    expect(branches.some((b) => b.includes('"qa"'))).toBe(true);
    expect(branches.some((b) => b.includes('"goal"'))).toBe(true);
    expect(branches.some((b) => b.includes("brief") && b.includes("audit") && b.includes("help"))).toBe(true);
  });

  it("setiap properti punya description — skema tool dibaca model, bukan manusia", () => {
    const walk = (o: { properties: Record<string, { description?: string }> }) => {
      for (const [k, v] of Object.entries(o.properties))
        expect(v.description, `properti "${k}" tanpa description`).toBeTruthy();
    };
    walk(BRIEF_PAYLOAD); walk(QA_PAYLOAD); walk(GOAL_PAYLOAD);
    walk(obj({ properties: PAGE_PARAMS }));
  });

  it("obj()/str() menghasilkan node JSON Schema yang sah", () => {
    const o = obj({ properties: { a: str("teks a") }, required: ["a"] });
    expect(o).toEqual({
      type: "object",
      properties: { a: { type: "string", description: "teks a" } },
      required: ["a"],
      additionalProperties: false,
    });
  });
});
