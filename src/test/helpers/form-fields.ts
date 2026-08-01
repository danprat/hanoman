// SPEC-490 · scanner JSX untuk kontrak placeholder. SATU definisi parser: test kontrak
// memakainya, bukan menyalin regex-nya sendiri (kelas bug "satu definisi, N call site",
// SPEC-431/448/475/481). Bukan parser TS penuh — cukup untuk menemukan tag form dan
// atribut literalnya, dan sengaja gagal-KERAS (melempar) daripada menebak.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Tag yang membawa kolom teks. `Select` TIDAK di sini: dropdown native selalu menampilkan
 *  opsi terpilih, jadi tak pernah ada kotak kosong tanpa petunjuk (lihat design doc). */
const TEXT_TAGS = ["Input", "HnTextarea", "textarea", "input"] as const;
const COMBOBOX_TAGS = ["MultiSelect"] as const;

/** Tipe input yang tak punya kolom teks, atau yang placeholder-nya diabaikan browser
 *  (`date`/`time`/… merender widget bawaan). */
const NON_TEXT_TYPES = new Set([
  "checkbox", "radio", "file", "hidden", "submit", "reset", "button", "range", "color", "image",
  "date", "datetime-local", "month", "week", "time",
]);

const LABEL_LOOKBEHIND = 500;

export type FormField = {
  file: string; line: number; tag: string; type: string;
  combobox: boolean;
  /** field yang wajib punya placeholder (sebelum memperhitungkan exemptReason) */
  inScope: boolean;
  exemptReason?: string;
  hasPlaceholder: boolean;
  placeholder?: string;
  label?: string;
};

/** Ganti isi komentar dengan spasi (panjang & baris dipertahankan) supaya `<input>` yang
 *  hidup di dalam prosa komentar tak terhitung sebagai call site. Terukur: 5 positif palsu. */
function maskComments(src: string): string {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") {
      const e = src.indexOf("\n", i); const stop = e < 0 ? src.length : e;
      out += " ".repeat(stop - i); i = stop; continue;
    }
    if (c === "/" && n === "*") {
      const e = src.indexOf("*/", i + 2); const stop = e < 0 ? src.length : e + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " "); i = stop; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let k = i + 1;
      while (k < src.length && src[k] !== c) { if (src[k] === "\\") k++; k++; }
      out += src.slice(i, Math.min(k + 1, src.length)); i = k + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

/** Ujung tag pembuka: `>` pertama yang tidak berada di dalam `{…}` maupun string. */
function tagEnd(src: string, from: number): number {
  let depth = 0;
  for (let k = from; k < src.length; k++) {
    const c = src[k];
    if (c === '"' || c === "'" || c === "`") {
      k++; while (k < src.length && src[k] !== c) { if (src[k] === "\\") k++; k++; }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return k;
  }
  return -1;
}

const attrLiteral = (body: string, name: string): string | undefined =>
  body.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];
const hasAttr = (body: string, name: string): boolean =>
  new RegExp(`\\b${name}\\s*=`).test(body);
/** `aria-hidden` sah ditulis TANPA nilai di JSX (`<input aria-hidden … />`, honeypot
 *  SPEC-352), jadi ia tak bisa dideteksi lewat `hasAttr` yang menuntut `=`. */
const ariaHidden = (body: string): boolean =>
  /\baria-hidden\b/.test(body) && !/\baria-hidden\s*=\s*"false"/.test(body);

/** Untuk membandingkan placeholder dengan label: buang `mis. `, tanda baca ekor, dan kapital. */
export function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/^mis\.\s*/, "").replace(/[….:•\s]+$/g, "").trim();
}

export function scanSource(file: string, source: string): FormField[] {
  const masked = maskComments(source);
  const out: FormField[] = [];
  for (const tag of [...TEXT_TAGS, ...COMBOBOX_TAGS]) {
    const re = new RegExp(`<${tag}(?=[\\s/>])`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const start = m.index;
      const end = tagEnd(masked, start);
      if (end < 0) throw new Error(`${file}: tag <${tag}> tanpa penutup di offset ${start}`);
      const body = source.slice(start, end + 1);
      const before = source.slice(Math.max(0, start - LABEL_LOOKBEHIND), start);
      const combobox = (COMBOBOX_TAGS as readonly string[]).includes(tag);
      const phAttr = combobox ? "searchPlaceholder" : "placeholder";
      const type = attrLiteral(body, "type") ?? "";
      const fieldLabels = [...before.matchAll(/<Field\b[^>]*?\blabel\s*=\s*"([^"]*)"/g)];
      out.push({
        file, line: source.slice(0, start).split("\n").length, tag, type, combobox,
        inScope: combobox || (!NON_TEXT_TYPES.has(type) && !ariaHidden(body)),
        exemptReason: before.match(/placeholder-exempt:\s*([^\n*}]+)/)?.[1]?.trim(),
        hasPlaceholder: hasAttr(body, phAttr),
        placeholder: attrLiteral(body, phAttr),
        label: attrLiteral(body, "aria-label") ?? fieldLabels.at(-1)?.[1],
      });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

export function scanDir(root: string): FormField[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) files.push(p);
    }
  };
  walk(root);
  return files.flatMap((f) => scanSource(f, readFileSync(f, "utf8")))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
