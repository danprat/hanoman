// Pesan steer menjadi giliran tambahan yang dikuras di antara fase. Ia tidak lagi menjadi
// prompt sebuah fase: prompt berupa AsyncIterable-lah yang dulu menahan stdin tetap terbuka
// selamanya, sehingga `claude` tak pernah keluar dan fase Execute tak pernah selesai.
export class SteerQueue {
  private buf: string[] = [];
  push(text: string) { this.buf.push(text); }
  drain(): string[] { const out = this.buf; this.buf = []; return out; }
}
