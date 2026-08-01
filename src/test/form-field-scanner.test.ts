import { describe, expect, it } from "vitest";
import { normalizeLabel, scanSource } from "./helpers/form-fields";

const one = (src: string) => {
  const f = scanSource("x.tsx", src);
  expect(f).toHaveLength(1);
  return f[0]!;
};

describe("scanSource", () => {
  it("menemukan Input dan membaca placeholder + aria-label", () => {
    const f = one(`<Input aria-label="Host" placeholder="203.0.113.10" />`);
    expect(f.tag).toBe("Input");
    expect(f.inScope).toBe(true);
    expect(f.hasPlaceholder).toBe(true);
    expect(f.placeholder).toBe("203.0.113.10");
    expect(f.label).toBe("Host");
  });

  it("mengabaikan tag yang hidup di dalam komentar", () => {
    expect(scanSource("x.tsx", `// DS Input meneruskan rest ke <input>\nconst a = 1;`)).toEqual([]);
    expect(scanSource("x.tsx", `/* pakai <textarea> polos */\nconst a = 1;`)).toEqual([]);
  });

  it("tidak berhenti pada > di dalam ekspresi prop", () => {
    const f = one(`<Input onChange={(e) => setX(e.target.value)} placeholder="mis. 5" />`);
    expect(f.placeholder).toBe("mis. 5");
  });

  it("menandai tipe non-teks di luar scope", () => {
    for (const t of ["checkbox", "radio", "file", "date"]) {
      expect(one(`<input type="${t}" />`).inScope).toBe(false);
    }
  });

  it("menandai field aria-hidden di luar scope", () => {
    expect(one(`<input aria-hidden value={t} />`).inScope).toBe(false);
  });

  it("membaca alasan dari komentar placeholder-exempt", () => {
    const f = one(`{/* placeholder-exempt: isi berkas apa pun bahasanya */}\n<textarea value={d} />`);
    expect(f.exemptReason).toBe("isi berkas apa pun bahasanya");
  });

  it("MultiSelect dinilai dari searchPlaceholder, bukan placeholder", () => {
    const a = one(`<MultiSelect placeholder="Pilih tools…" value={v} />`);
    expect(a.combobox).toBe(true);
    expect(a.hasPlaceholder).toBe(false);
    const b = one(`<MultiSelect placeholder="Pilih tools…" searchPlaceholder="mis. Read" value={v} />`);
    expect(b.hasPlaceholder).toBe(true);
    expect(b.placeholder).toBe("mis. Read");
  });

  it("jatuh ke label Field terdekat saat aria-label absen", () => {
    expect(one(`<Field label="Port"><Input placeholder="22" /></Field>`).label).toBe("Port");
  });

  it("tak memungut label Field yang jauh (di luar 500 karakter)", () => {
    const src = `<Field label="Jauh"></Field>${" ".repeat(600)}<Input placeholder="x" />`;
    expect(one(src).label).toBeUndefined();
  });

  it("normalizeLabel membuang prefiks mis. dan tanda baca ekor", () => {
    expect(normalizeLabel("Cari backlog…")).toBe("cari backlog");
    expect(normalizeLabel("mis. Cari Backlog")).toBe("cari backlog");
  });
});
