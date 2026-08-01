// SPEC-482 · ADR-0099 · galat sebagai kalimat yang bisa ditindaklanjuti, bukan dump HTTP.
//
// Pelajaran SPEC-472: pesan galat yang tak menyebut sebabnya membuat 152 baris jejak identik
// sepanjang 552 char dengan nol informasi. Yang menyelamatkan bukan lebih banyak byte melainkan
// menyebut PERSIS apa yang harus diubah dan SIAPA yang bisa mengubahnya.
export type ErrorCtx = {
  host: string;
  /** Hasil probe `/api/health`. `null` = belum sempat diprobe. */
  hostAlive: boolean | null;
  toolName: string;
  method: string;
  path: string;
};

const TAIL = 500;
const tail = (s: string) => (s.length <= TAIL ? s : "…" + s.slice(-TAIL));

const errField = (body: unknown): unknown =>
  body !== null && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : undefined;

function flatten(err: unknown): string | null {
  if (typeof err === "string") return err;
  if (err !== null && typeof err === "object" && "fieldErrors" in err) {
    const fe = (err as { fieldErrors: Record<string, string[]> }).fieldErrors;
    const parts = Object.entries(fe).map(([k, v]) => `${k}: ${v.join("; ")}`);
    if (parts.length) return parts.join(" · ");
  }
  return null;
}

export function explainNetworkError(err: unknown, ctx: { host: string }): string {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code
    ?? (err as { code?: string })?.code ?? "";
  if (code === "ECONNREFUSED")
    return `Tidak ada hanoman di ${ctx.host} — sambungan tidak diterima. Pastikan \`hanoman start\` sedang jalan di sana, atau perbaiki HANOMAN_HOST di konfigurasi klien MCP ini.`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return `Nama host ${ctx.host} tak ditemukan. Periksa ejaan HANOMAN_HOST di konfigurasi klien MCP ini.`;
  if (code === "ECONNRESET" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT")
    return `Sambungan ke ${ctx.host} putus atau kehabisan waktu. Periksa jaringan dan reverse proxy di depan instance itu.`;
  return `Gagal menghubungi ${ctx.host}: ${tail(String((err as Error)?.message ?? err))}`;
}

export function explainHttpError(status: number, body: unknown, ctx: ErrorCtx): string {
  const said = flatten(errField(body));
  const isLead = ctx.path.startsWith("/lead");

  if (status === 401) {
    return ctx.hostAlive === false
      ? `${ctx.host} tidak menjawab sebagai instance hanoman yang sehat. Periksa HANOMAN_HOST di konfigurasi klien MCP ini — token yang benar pun akan ditolak oleh alamat yang salah.`
      : `${ctx.host} hidup, tapi menolak token yang dipakai. Agent token diterbitkan PER-INSTANCE: token yang dibuat di instance lain SELALU 401 di sini, dan itu bukan bug. Yang perlu diperiksa manusia, berurutan: (1) HANOMAN_HOST menunjuk instance yang menerbitkan tokennya; (2) master switch di Settings → Akses AI Agent menyala; (3) tokennya belum dicabut atau dinonaktifkan.`;
  }

  if (status === 403) {
    const need = (body as { need?: string })?.need;
    if (need)
      return `Token yang dipakai kurang capability \`${need}\`. Ini tak bisa diakali dari sisi agen: MANUSIA harus menambahkan \`${need}\` ke token itu di Settings → Akses AI Agent. Sebutkan capability persis itu saat memintanya.`;
    return "Route ini sengaja hanya untuk sesi manusia yang login — agent token tak akan pernah bisa mengaksesnya, apa pun capability-nya (kelola user, agent token, device token, dan sync). Jangan cari jalan lain; sampaikan ke manusia bila memang perlu.";
  }

  if (status === 400)
    return said
      ? `Permintaan ditolak: ${said}`
      : `Permintaan ditolak (400) oleh ${ctx.method} ${ctx.path}. ${tail(JSON.stringify(body ?? ""))}`;

  if (status === 404)
    return said ? `Tidak ditemukan: ${said}` : `Tidak ditemukan: ${ctx.method} ${ctx.path}.`;

  if (status === 409) {
    if (isLead)
      return `hanoman-lead tidak aktif untuk permintaan ini (lead mati, dijeda, atau proyeknya belum opt-in). Kembali ke perilaku biasa: berhenti dan tunggu manusia. ${said ?? ""}`.trim();
    if (ctx.toolName === "hanoman_backlog_update")
      return `${said ?? "Backlog item sudah dimulai"} — konten hanya bisa diubah selagi item belum dimulai (stage \`brainstorming\` dan belum pernah punya sesi). Cek field \`editable\` lewat hanoman_backlog_get sebelum mencoba lagi.`;
    return said ? `Bentrok: ${said}` : `Bentrok (409) pada ${ctx.method} ${ctx.path}.`;
  }

  if (status === 422)
    return said ? `Ditolak: ${said}` : `Ditolak (422) pada ${ctx.method} ${ctx.path}.`;

  if (status === 503 && isLead)
    return `hanoman-lead sedang penuh dan permintaan ini masuk antre lalu ditolak. Ini penolakan sementara — boleh diulang beberapa saat lagi. ${said ?? ""}`.trim();

  if (status === 504 && isLead)
    return "hanoman-lead tak berhasil memutuskan dalam batas waktunya. Kegagalannya sudah tercatat di jejak dan operator sudah dinotifikasi — jangan mengulang terus-menerus; lanjutkan tanpa putusan atau tunggu manusia.";

  return `${ctx.method} ${ctx.path} menjawab ${status}. ${said ?? tail(typeof body === "string" ? body : JSON.stringify(body ?? ""))}`;
}
