// SPEC-482 · ADR-0099 · satu titik keluar untuk redaksi token. Dipasang di SEMUA teks yang
// meninggalkan proses (hasil tool, pesan galat, stderr) — bukan di tiap call site. SPEC-472
// membuktikan sekali cukup untuk gagal: pesan `execFile` memuat argv, dan argv memuat rahasia.
const MASK = "«token disembunyikan»";

export function redactToken(text: string, token: string): string {
  // `split`/`join` alih-alih regex: token bisa memuat karakter yang bermakna di regex, dan
  // meng-escape-nya adalah langkah yang mudah dilupakan saat kode ini disalin.
  let out = token.length > 0 ? text.split(token).join(MASK) : text;
  // Bentuknya juga, bukan hanya nilainya: token instance LAIN yang kebetulan lewat tetap rahasia.
  return out.replace(/hnm_agt_[A-Za-z0-9_-]+/g, MASK);
}
