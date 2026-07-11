// SPEC-180 · membangkitkan nada notifikasi (13 variasi) sebagai WAV PCM 16-bit mono.
// Deterministik, in-repo — memenuhi pilihan "file audio bundled" tanpa mengunduh aset.
// Jalankan sekali: `node scripts/gen-notify-sounds.mjs`. Aman diulang (menimpa).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 22050;
function synth(segments) { // segments: [{ freq, dur }]
  const out = [];
  for (const { freq, dur } of segments) {
    const n = Math.floor(SR * dur);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.008, (dur - t) / 0.008); // attack/release 8ms → tanpa klik
      out.push(Math.sin(2 * Math.PI * freq * t) * env * 0.6);
    }
  }
  return out;
}
function wav(floats) {
  const data = Buffer.alloc(floats.length * 2);
  for (let i = 0; i < floats.length; i++) {
    const s = Math.max(-1, Math.min(1, floats[i]));
    data.writeInt16LE((s * 32767) | 0, i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const TONES = {
  "notify-short":  [{ freq: 880, dur: 0.15 }],
  "notify-medium": [{ freq: 660, dur: 0.18 }, { freq: 988, dur: 0.20 }],
  "notify-long":   [{ freq: 523.25, dur: 0.26 }, { freq: 659.25, dur: 0.26 }, { freq: 783.99, dur: 0.32 }],
  // 10 variasi tambahan, durasi ~0.1s → 0.9s.
  "notify-blip":    [{ freq: 1046.5, dur: 0.08 }],
  "notify-pop":     [{ freq: 440, dur: 0.09 }],
  "notify-ping":    [{ freq: 783.99, dur: 0.08 }, { freq: 1046.5, dur: 0.10 }],
  "notify-coin":    [{ freq: 987.77, dur: 0.07 }, { freq: 1318.51, dur: 0.18 }],
  "notify-alert":   [{ freq: 880, dur: 0.09 }, { freq: 659.25, dur: 0.08 }, { freq: 880, dur: 0.13 }],
  "notify-chime":   [{ freq: 1318.51, dur: 0.13 }, { freq: 1046.5, dur: 0.13 }, { freq: 880, dur: 0.16 }],
  "notify-success": [{ freq: 523.25, dur: 0.11 }, { freq: 659.25, dur: 0.11 }, { freq: 783.99, dur: 0.11 }, { freq: 1046.5, dur: 0.11 }],
  "notify-bell":    [{ freq: 987.77, dur: 0.22 }, { freq: 1318.51, dur: 0.30 }],
  "notify-marimba": [{ freq: 587.33, dur: 0.20 }, { freq: 739.99, dur: 0.20 }, { freq: 880, dur: 0.20 }],
  "notify-fanfare": [{ freq: 523.25, dur: 0.20 }, { freq: 783.99, dur: 0.20 }, { freq: 1046.5, dur: 0.20 }, { freq: 1318.51, dur: 0.30 }],
};
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/public/sounds");
mkdirSync(dir, { recursive: true });
for (const [name, segs] of Object.entries(TONES)) {
  const buf = wav(synth(segs));
  if (buf.length <= 44) throw new Error(`wav ${name} kosong`);
  writeFileSync(resolve(dir, `${name}.wav`), buf);
  console.log(`wrote ${name}.wav (${buf.length} bytes)`);
}
