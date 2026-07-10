// Pesan steer menjadi giliran tambahan yang dikuras di antara fase. Ia tidak lagi menjadi
// prompt sebuah fase: prompt berupa AsyncIterable-lah yang dulu menahan stdin tetap terbuka
// selamanya, sehingga `claude` tak pernah keluar dan fase Execute tak pernah selesai.
//
// SPEC-157 memakai kelas yang sama untuk antrian JAWABAN (instans terpisah). `next()` ada
// demi itu: buffer menutup balapan "jawaban ter-publish sebelum runner sempat menunggu".
export class SteerQueue {
  private buf: string[] = [];
  private waiters: ((text: string) => void)[] = [];
  push(text: string) {
    const w = this.waiters.shift();
    if (w) w(text);
    else this.buf.push(text);
  }
  drain(): string[] { const out = this.buf; this.buf = []; return out; }
  /** Pesan berikutnya — dari buffer kalau sudah ada, kalau tidak menunggu `push`. */
  next(): Promise<string> {
    const t = this.buf.shift();
    return t !== undefined ? Promise.resolve(t) : new Promise((r) => this.waiters.push(r));
  }
}
