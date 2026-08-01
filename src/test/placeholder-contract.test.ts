// SPEC-490 · placeholder = contoh nilai, bukan pengulangan label. Ditegakkan atas SUMBER,
// bukan DOM: field tanpa placeholder terlihat persis seperti field yang belum diketik, jadi
// tak ada test render yang akan menangkapnya, dan call site form baru lahir terus-menerus.
import { describe, expect, it } from "vitest";
import { normalizeLabel, scanDir, type FormField } from "./helpers/form-fields";

const ROOT = "src/src";
const all = scanDir(ROOT);
const where = (f: FormField) => `${f.file}:${f.line} <${f.tag}${f.type ? ` type="${f.type}"` : ""}>`;

describe("kontrak placeholder", () => {
  // Scanner yang diam-diam berhenti memberi gejala yang sama dengan "semua lulus".
  it("benar-benar memindai field form", () => {
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter((f) => f.inScope).length).toBeGreaterThan(50);
  });

  it("setiap field teks/textarea/combobox punya placeholder", () => {
    const missing = all.filter((f) => f.inScope && !f.exemptReason && !f.hasPlaceholder);
    expect(missing.map(where)).toEqual([]);
  });

  it("placeholder tidak mengulang labelnya", () => {
    const echoes = all.filter((f) =>
      f.inScope && !f.exemptReason && f.placeholder && f.label &&
      normalizeLabel(f.placeholder) === normalizeLabel(f.label));
    expect(echoes.map((f) => `${where(f)} placeholder="${f.placeholder}" label="${f.label}"`)).toEqual([]);
  });

  it("setiap pengecualian menyebut alasannya", () => {
    const blank = all.filter((f) => f.exemptReason !== undefined && f.exemptReason.length < 8);
    expect(blank.map(where)).toEqual([]);
  });
});
