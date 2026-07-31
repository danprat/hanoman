// SPEC-293 · deep-link backlog lewat hash fragment (SPA hanoman tak punya router; ADR-0071).
// URL kanonik satu backlog = `${origin}${pathname}#spec=<SPEC-ID>`. App mem-parse-nya sekali saat
// mount lalu membuka SpecDetail. Modul murni ini dipakai App (parse) + Triase (build).

// Ekstrak SPEC-ID dari hash `#spec=<id>` (juga `#a=1&spec=<id>`). null bila tak ada.
export function parseSpecHash(hash: string): string | null {
  const m = /(?:^|[#&])spec=([^&]+)/.exec(hash || "");
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}

// Bangun URL absolut ke satu backlog dari lokasi saat ini.
export function specDeepLink(id: string, loc: { origin: string; pathname: string } = window.location): string {
  return `${loc.origin}${loc.pathname}#spec=${encodeURIComponent(id)}`;
}
