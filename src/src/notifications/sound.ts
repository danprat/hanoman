// SPEC-180 · nada notifikasi backlog selesai. Aset di src/public/sounds (Vite serve di root).
export type NotifySound = "off" | "short" | "medium" | "long";

export function playNotifySound(kind: NotifySound): void {
  if (kind === "off") return;
  try {
    // Autoplay bisa diblokir sebelum ada interaksi user; abaikan penolakannya.
    void new Audio(`/sounds/notify-${kind}.wav`).play().catch(() => { });
  } catch { /* lingkungan tanpa Audio (mis. test node) */ }
}
