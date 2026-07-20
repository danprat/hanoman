// SPEC-253 · klien API PUBLIK Help Center — dipanggil dari PublicHelpApp (tanpa auth, same-origin).
import { paths, type HelpInfo, type PublicTicketStatus } from "@hanoman/shared";

export const helpApi = {
  async getInfo(slug: string): Promise<HelpInfo> {
    const r = await fetch(paths.help(slug));
    if (!r.ok) throw new Error("Help Center tak tersedia untuk project ini.");
    return r.json();
  },
  // form = FormData (multipart) berisi category/title/detail/email/hp + files[].
  async submit(slug: string, form: FormData): Promise<{ number: number; key: string; statusPath: string }> {
    const r = await fetch(paths.helpTickets(slug), { method: "POST", body: form });
    if (r.status === 429) throw new Error("Terlalu banyak permintaan. Coba lagi beberapa saat lagi.");
    if (r.status === 404) throw new Error("Help Center tidak aktif untuk project ini.");
    if (!r.ok) throw new Error("Gagal mengirim keluhan. Pastikan semua isian wajib terisi.");
    return r.json();
  },
  async status(slug: string, key: string): Promise<PublicTicketStatus> {
    const r = await fetch(paths.helpStatus(slug, key));
    if (!r.ok) throw new Error("Tiket tidak ditemukan.");
    return r.json();
  },
};
