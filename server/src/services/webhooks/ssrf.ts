import { lookup as dnsLookup } from "node:dns/promises";
import { isIPv4 } from "node:net";

// SPEC-481 · ADR-0100 · pagar SSRF. Dua lapis dengan pertanyaan berbeda:
//   validateWebhookUrl  — bentuk URL, ditegakkan saat DISIMPAN.
//   checkDestination    — alamat yang benar-benar akan dihubungi, ditegakkan SETIAP percobaan.
// Lapis kedua wajib per-percobaan: host publik hari ini bisa menunjuk 127.0.0.1 besok. Ini
// mempersempit DNS rebinding, TIDAK menutupnya (jendela antara resolve dan connect tetap ada) —
// keterbatasan itu ditulis apa adanya di halaman dokumentasi.

export function validateWebhookUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { ok: false, error: "URL tak valid" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, error: "hanya http atau https" };
  if (url.username || url.password)
    return { ok: false, error: "kredensial di URL tak diizinkan" };
  if (!url.hostname) return { ok: false, error: "hostname kosong" };
  return { ok: true, url };
}

function blockedV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 127) return true;                        // unspecified & loopback
  if (a === 10) return true;                                    // private
  if (a === 172 && b >= 16 && b <= 31) return true;             // private
  if (a === 192 && b === 168) return true;                      // private
  if (a === 169 && b === 254) return true;                      // link-local (metadata cloud)
  if (a === 100 && b >= 64 && b <= 127) return true;            // CGNAT
  if (a === 192 && b === 0) return true;                        // IETF protocol assignments
  if (a >= 224) return true;                                    // multicast + reserved + broadcast
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (!v) return true;
  // IPv4-mapped IPv6 (`::ffff:10.0.0.1`) adalah cara paling murah menyelundupkan alamat internal.
  const mapped = v.startsWith("::ffff:") ? v.slice(7) : v;
  if (isIPv4(mapped)) return blockedV4(mapped);
  if (!v.includes(":")) return true;                             // bukan IP → jangan ditebak
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe80") || v.startsWith("fec0")) return true; // link-local / site-local
  if (/^f[cd]/.test(v)) return true;                             // unique local fc00::/7
  if (v.startsWith("ff")) return true;                           // multicast
  return false;
}

/**
 * Gerbang SAAT SIMPAN: bentuk URL + host yang sudah berupa IP literal. Sengaja TIDAK menyentuh
 * DNS — menaruh resolusi jaringan di jalur tulis CRUD membuat pendaftaran endpoint gagal saat
 * DNS lambat/mati (dan fail-closed di sana berarti operator tak bisa mendaftar apa pun secara
 * offline). Gerbang yang sebenarnya adalah `checkDestination`, yang jalan di SETIAP percobaan
 * kirim; ini hanya umpan balik cepat untuk kasus yang tak butuh jaringan untuk diketahui salah.
 */
export function checkUrlShape(
  raw: string, allowPrivate: boolean,
): { ok: true; url: URL } | { ok: false; error: string } {
  const parsed = validateWebhookUrl(raw);
  if (!parsed.ok) return parsed;
  if (allowPrivate) return parsed;
  const host = parsed.url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIPv4(host) || host.includes(":");
  if (literal && isBlockedAddress(host))
    return {
      ok: false,
      error: `alamat internal ditolak (${host}) — nyalakan "izinkan alamat internal" bila memang disengaja`,
    };
  // `localhost` bukan IP literal tapi semua orang menganggapnya begitu; menolaknya di sini
  // menghemat satu percobaan kirim yang sudah pasti gagal.
  if (host === "localhost" || host.endsWith(".localhost"))
    return {
      ok: false,
      error: `alamat internal ditolak (${host}) — nyalakan "izinkan alamat internal" bila memang disengaja`,
    };
  return parsed;
}

export type Lookup = (host: string) => Promise<{ address: string }[]>;
const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true });

export async function checkDestination(
  url: URL, allowPrivate: boolean, lookup: Lookup = defaultLookup,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (allowPrivate) return { ok: true };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addrs: { address: string }[];
  // Gagal-TERTUTUP: DNS yang tak bisa menjawab bukan izin untuk mencoba menghubunginya.
  try { addrs = await lookup(host); } catch (e) {
    return { ok: false, error: `DNS gagal: ${(e as Error).message}` };
  }
  if (!addrs.length) return { ok: false, error: "DNS tak mengembalikan alamat" };
  // SETIAP alamat harus lolos: host round-robin yang satu recordnya 10.0.0.5 tetap jalan masuk.
  for (const a of addrs)
    if (isBlockedAddress(a.address))
      return {
        ok: false,
        error: `alamat internal ditolak (${a.address}) — nyalakan "izinkan alamat internal" bila memang disengaja`,
      };
  return { ok: true };
}
