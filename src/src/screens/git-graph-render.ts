/* git-graph-render (SPEC-233) — helper render pesan commit: emoji shortcode, markdown inline,
   linkify (URL + issue + parent-hash), gravatar URL. Dep-nol; dipakai GitGraph detail. */
import React from "react";

// Subset shortcode umum + gitmoji. Cukup untuk pesan commit; tambah sesuai kebutuhan.
const EMOJI: Record<string, string> = {
  rocket: "🚀", sparkles: "✨", bug: "🐛", fire: "🔥", tada: "🎉", boom: "💥", wrench: "🔧",
  memo: "📝", art: "🎨", zap: "⚡", lock: "🔒", recycle: "♻️", construction: "🚧", white_check_mark: "✅",
  ambulance: "🚑", bookmark: "🔖", green_heart: "💚", arrow_up: "⬆️", arrow_down: "⬇️", pushpin: "📌",
  wastebasket: "🗑️", heavy_plus_sign: "➕", heavy_minus_sign: "➖", pencil2: "✏️", rewind: "⏪",
  twisted_rightwards_arrows: "🔀", package: "📦", alien: "👽", truck: "🚚", page_facing_up: "📄",
  bulb: "💡", beers: "🍻", speech_balloon: "💬", card_file_box: "🗃️", loud_sound: "🔊", mute: "🔇",
  see_no_evil: "🙈", camera_flash: "📸", label: "🏷️", seedling: "🌱", dizzy: "💫", adhesive_bandage: "🩹",
};

export function emojify(text: string): string {
  return text.replace(/:([a-z0-9_+-]+):/g, (m, code) => EMOJI[code] ?? m);
}

export function gravatarUrl(email: string, size = 24): string {
  return `https://www.gravatar.com/avatar/${md5((email || "").trim().toLowerCase())}?s=${size}&d=identicon`;
}

// Linkify pesan → node React. URL http(s), nomor issue (#123 via pola config), dan parent-hash (7-40 hex).
// `issuePattern` = URL dengan $1 sebagai placeholder nomor issue (kosong = tak melinkkan issue).
export function linkify(text: string, issuePattern?: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Pisah per token: URL | #issue | hash-40 | teks biasa.
  const re = /(https?:\/\/[^\s]+)|(#\d+)|(\b[0-9a-f]{7,40}\b)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const link = (href: string, label: string) =>
      React.createElement("a", { key: i++, href, target: "_blank", rel: "noreferrer", style: { color: "var(--brass-700)" } }, label);
    if (m[1]) parts.push(link(m[1], m[1]));
    else if (m[2] && issuePattern) parts.push(link(issuePattern.replace("$1", m[2].slice(1)), m[2]));
    else if (m[2]) parts.push(m[2]);
    else if (m[3]) parts.push(React.createElement("span", { key: i++, style: { fontFamily: "var(--font-mono)", color: "var(--text-muted)" } }, m[3]));
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Komposisi render pesan commit: emoji → link (url/issue/hash) → markdown inline pada segmen teks.
export function renderMessage(text: string, opts: { emoji?: boolean; markdown?: boolean; issuePattern?: string } = {}): React.ReactNode[] {
  const t = opts.emoji === false ? text : emojify(text);
  const linked = linkify(t, opts.issuePattern);
  if (opts.markdown === false) return linked;
  return linked.flatMap((node) => (typeof node === "string" ? mdInline(node) : [node]));
}

// Markdown inline minimal → node React: **bold**, *italic*, `code`. Aman (tanpa dangerouslySetInnerHTML).
export function mdInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(React.createElement("strong", { key: i++ }, m[1]));
    else if (m[2]) parts.push(React.createElement("em", { key: i++ }, m[2]));
    else if (m[3]) parts.push(React.createElement("code", { key: i++, style: { fontFamily: "var(--font-mono)", background: "var(--bone-100)", padding: "0 3px", borderRadius: 3 } }, m[3]));
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// md5 kecil (dep-nol) untuk gravatar. Implementasi standar RFC 1321.
function md5(str: string): string {
  function rl(n: number, c: number) { return (n << c) | (n >>> (32 - c)); }
  function au(x: number, y: number) { const l = (x & 0xffff) + (y & 0xffff); const m = (x >> 16) + (y >> 16) + (l >> 16); return (m << 16) | (l & 0xffff); }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) { return au(rl(au(au(a, q), au(x, t)), s), b); }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function tb(s: string) { const n = s.length, b: number[] = []; for (let i = 0; i < n * 8; i += 8) b[i >> 5] = (b[i >> 5] ?? 0) | ((s.charCodeAt(i / 8) & 0xff) << (i % 32)); return b; }
  function hx(n: number[]) { let s = ""; for (let i = 0; i < n.length * 4; i++) s += (((n[i >> 2] ?? 0) >> ((i % 4) * 8 + 4)) & 0xf).toString(16) + (((n[i >> 2] ?? 0) >> ((i % 4) * 8)) & 0xf).toString(16); return s; }
  const x = tb(str), len = str.length * 8;
  x[len >> 5] = (x[len >> 5] ?? 0) | (0x80 << (len % 32)); x[(((len + 64) >>> 9) << 4) + 14] = len;
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < x.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, x[i]! || 0, 7, -680876936); d = ff(d, a, b, c, x[i + 1]! || 0, 12, -389564586); c = ff(c, d, a, b, x[i + 2]! || 0, 17, 606105819); b = ff(b, c, d, a, x[i + 3]! || 0, 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4]! || 0, 7, -176418897); d = ff(d, a, b, c, x[i + 5]! || 0, 12, 1200080426); c = ff(c, d, a, b, x[i + 6]! || 0, 17, -1473231341); b = ff(b, c, d, a, x[i + 7]! || 0, 22, -45705983);
    a = ff(a, b, c, d, x[i + 8]! || 0, 7, 1770035416); d = ff(d, a, b, c, x[i + 9]! || 0, 12, -1958414417); c = ff(c, d, a, b, x[i + 10]! || 0, 17, -42063); b = ff(b, c, d, a, x[i + 11]! || 0, 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12]! || 0, 7, 1804603682); d = ff(d, a, b, c, x[i + 13]! || 0, 12, -40341101); c = ff(c, d, a, b, x[i + 14]! || 0, 17, -1502002290); b = ff(b, c, d, a, x[i + 15]! || 0, 22, 1236535329);
    a = gg(a, b, c, d, x[i + 1]! || 0, 5, -165796510); d = gg(d, a, b, c, x[i + 6]! || 0, 9, -1069501632); c = gg(c, d, a, b, x[i + 11]! || 0, 14, 643717713); b = gg(b, c, d, a, x[i]! || 0, 20, -373897302);
    a = gg(a, b, c, d, x[i + 5]! || 0, 5, -701558691); d = gg(d, a, b, c, x[i + 10]! || 0, 9, 38016083); c = gg(c, d, a, b, x[i + 15]! || 0, 14, -660478335); b = gg(b, c, d, a, x[i + 4]! || 0, 20, -405537848);
    a = gg(a, b, c, d, x[i + 9]! || 0, 5, 568446438); d = gg(d, a, b, c, x[i + 14]! || 0, 9, -1019803690); c = gg(c, d, a, b, x[i + 3]! || 0, 14, -187363961); b = gg(b, c, d, a, x[i + 8]! || 0, 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13]! || 0, 5, -1444681467); d = gg(d, a, b, c, x[i + 2]! || 0, 9, -51403784); c = gg(c, d, a, b, x[i + 7]! || 0, 14, 1735328473); b = gg(b, c, d, a, x[i + 12]! || 0, 20, -1926607734);
    a = hh(a, b, c, d, x[i + 5]! || 0, 4, -378558); d = hh(d, a, b, c, x[i + 8]! || 0, 11, -2022574463); c = hh(c, d, a, b, x[i + 11]! || 0, 16, 1839030562); b = hh(b, c, d, a, x[i + 14]! || 0, 23, -35309556);
    a = hh(a, b, c, d, x[i + 1]! || 0, 4, -1530992060); d = hh(d, a, b, c, x[i + 4]! || 0, 11, 1272893353); c = hh(c, d, a, b, x[i + 7]! || 0, 16, -155497632); b = hh(b, c, d, a, x[i + 10]! || 0, 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13]! || 0, 4, 681279174); d = hh(d, a, b, c, x[i]! || 0, 11, -358537222); c = hh(c, d, a, b, x[i + 3]! || 0, 16, -722521979); b = hh(b, c, d, a, x[i + 6]! || 0, 23, 76029189);
    a = hh(a, b, c, d, x[i + 9]! || 0, 4, -640364487); d = hh(d, a, b, c, x[i + 12]! || 0, 11, -421815835); c = hh(c, d, a, b, x[i + 15]! || 0, 16, 530742520); b = hh(b, c, d, a, x[i + 2]! || 0, 23, -995338651);
    a = ii(a, b, c, d, x[i]! || 0, 6, -198630844); d = ii(d, a, b, c, x[i + 7]! || 0, 10, 1126891415); c = ii(c, d, a, b, x[i + 14]! || 0, 15, -1416354905); b = ii(b, c, d, a, x[i + 5]! || 0, 21, -57434055);
    a = ii(a, b, c, d, x[i + 12]! || 0, 6, 1700485571); d = ii(d, a, b, c, x[i + 3]! || 0, 10, -1894986606); c = ii(c, d, a, b, x[i + 10]! || 0, 15, -1051523); b = ii(b, c, d, a, x[i + 1]! || 0, 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8]! || 0, 6, 1873313359); d = ii(d, a, b, c, x[i + 15]! || 0, 10, -30611744); c = ii(c, d, a, b, x[i + 6]! || 0, 15, -1560198380); b = ii(b, c, d, a, x[i + 13]! || 0, 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4]! || 0, 6, -145523070); d = ii(d, a, b, c, x[i + 11]! || 0, 10, -1120210379); c = ii(c, d, a, b, x[i + 2]! || 0, 15, 718787259); b = ii(b, c, d, a, x[i + 9]! || 0, 21, -343485551);
    a = au(a, oa); b = au(b, ob); c = au(c, oc); d = au(d, od);
  }
  return hx([a, b, c, d]);
}
