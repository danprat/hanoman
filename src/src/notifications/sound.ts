// SPEC-180 · nada notifikasi backlog selesai. Aset di src/public/sounds (Vite serve di root).
// SPEC-192 · autoplay browser memblokir play() dari poll timer (tanpa gestur user). Kita pakai
// ULANG satu elemen Audio dan "unlock" sekali pada gestur pertama; sesudahnya play() dari timer
// diizinkan (juga di Safari, yang tak cukup dengan sticky-activation dokumen untuk elemen segar).
export type NotifySound = "off" | "short" | "medium" | "long"
  | "blip" | "pop" | "ping" | "coin" | "alert" | "chime" | "success" | "bell" | "marimba" | "fanfare";

const src = (kind: NotifySound) => `/sounds/notify-${kind}.wav`;

let el: HTMLAudioElement | null | undefined; // undefined = belum dicoba; null = tak ada Audio (test node)
function element(): HTMLAudioElement | null {
  if (el === undefined) { try { el = new Audio(); } catch { el = null; } }
  return el;
}

let unlocked = false;
// Panggil sekali dari gestur user pertama. Memutar elemen bersama saat muted lalu pause memberi
// elemen itu aktivasi user permanen, sehingga play() berikutnya dari timer tak ditolak.
export function unlockNotifySound(): void {
  if (unlocked) return;
  const a = element();
  if (!a) return;
  unlocked = true;
  try {
    a.muted = true;
    a.src = src("short");
    void Promise.resolve(a.play()).then(() => { a.pause(); a.muted = false; }).catch(() => { a.muted = false; });
  } catch { a.muted = false; }
}

export function playNotifySound(kind: NotifySound): void {
  if (kind === "off") return;
  const a = element();
  if (!a) return;
  try {
    a.muted = false;
    a.src = src(kind);
    a.currentTime = 0; // ulang dari awal bila kind sama diputar dua kali beruntun
    void Promise.resolve(a.play()).catch(() => { }); // masih bisa ditolak bila belum ada gestur; abaikan
  } catch { /* lingkungan tanpa Audio (mis. test node) */ }
}
