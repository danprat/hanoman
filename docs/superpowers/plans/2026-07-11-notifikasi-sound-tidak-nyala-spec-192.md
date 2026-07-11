# Notifikasi Sound Tidak Nyala Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bunyi notifikasi `done`/`decision` benar-benar terdengar saat episodenya terjadi (bukan hanya di tombol Preview).

**Architecture:** Akar masalah = autoplay browser memblokir `Audio.play()` dari poll timer (tanpa gestur user); `new Audio()` tiap panggil tak pernah dapat aktivasi user. Fix: pakai ULANG satu elemen `Audio` singleton + `unlockNotifySound()` yang di-prime (muted→play→pause) pada gestur user pertama, dipasang di `NotificationsProvider`. Nol perubahan server/skema. Lihat `docs/superpowers/specs/2026-07-11-notifikasi-sound-tidak-nyala-spec-192-design.md`.

**Tech Stack:** React 18 + TS (Vite), Vitest + jsdom, HTMLAudioElement.

## Global Constraints

- TypeScript strict; nol perubahan server/route/skema Prisma/tipe.
- Update `internal/docs` yang tersentuh **dalam commit yang sama** (ADR-0033 + frontend-implementation.md).
- Ikuti gaya file yang ada (komentar Indonesia, referensi SPEC).

---

### Task 1: `sound.ts` — reuse satu elemen + `unlockNotifySound`

**Files:**
- Modify: `src/src/notifications/sound.ts`
- Test: `src/test/sound.test.ts` (create)

**Interfaces:**
- Consumes: aset `src/public/sounds/notify-<kind>.wav` (sudah ada, di-serve Vite di root).
- Produces:
  - `playNotifySound(kind: NotifySound): void` — sekarang memakai elemen `Audio` bersama.
  - `unlockNotifySound(): void` — idempoten; prime elemen bersama muted pada gestur pertama.
  - `type NotifySound` — tak berubah.

- [x] **Step 1: Tulis test yang gagal** — `src/test/sound.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("sound.ts (SPEC-192)", () => {
  let instances: HTMLMediaElement[];
  let mutedAtPlay: boolean[];
  let play: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules(); // sound.ts punya state modul (elemen singleton + flag unlocked)
    instances = [];
    mutedAtPlay = [];
    play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      instances.push(this);
      mutedAtPlay.push(this.muted);
      return Promise.resolve();
    });
  });

  it("playNotifySound('off') tak memutar apa pun", async () => {
    const { playNotifySound } = await import("../src/notifications/sound");
    playNotifySound("off");
    expect(play).not.toHaveBeenCalled();
  });

  it("memutar aset yang benar dan memakai ULANG satu elemen", async () => {
    const { playNotifySound } = await import("../src/notifications/sound");
    playNotifySound("short");
    playNotifySound("alert");
    expect(play).toHaveBeenCalledTimes(2);
    expect(instances[0]).toBe(instances[1]); // elemen sama dipakai ulang (bukan new Audio tiap kali)
    expect(instances[1].src).toMatch(/\/sounds\/notify-alert\.wav$/);
  });

  it("unlockNotifySound: prime muted, sekali, idempoten", async () => {
    const { unlockNotifySound } = await import("../src/notifications/sound");
    unlockNotifySound();
    unlockNotifySound();
    expect(play).toHaveBeenCalledTimes(1);
    expect(mutedAtPlay[0]).toBe(true); // klik pertama user tak berbunyi kaget
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm --filter @hanoman/app exec vitest run test/sound.test.ts`
Expected: FAIL — `unlockNotifySound` belum di-export / masih `new Audio()` tiap panggil (instances tidak sama).

- [x] **Step 3: Implementasi minimal** — ganti isi `src/src/notifications/sound.ts`

```ts
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
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm --filter @hanoman/app exec vitest run test/sound.test.ts`
Expected: PASS (3 test).

- [x] **Step 5: Regresi cepat** — pastикан test notifikasi lama tetap hijau + typecheck

Run: `pnpm --filter @hanoman/app exec vitest run test/notifications-context.test.tsx && pnpm --filter @hanoman/app typecheck`
Expected: PASS, nol error TS.

- [x] **Step 6: Commit**

```bash
git add src/src/notifications/sound.ts src/test/sound.test.ts
git commit -m "fix(notif): reuse & unlock satu elemen Audio agar bunyi notifikasi keluar (SPEC-192)"
```

---

### Task 2: Wire `unlockNotifySound` di gestur pertama + update docs

**Files:**
- Modify: `src/src/notifications/NotificationsContext.tsx` (import + effect yang sudah ada, sekitar baris 5 & 60-64)
- Modify: `internal/docs/frontend/frontend-implementation.md:234-236`
- Modify: `internal/docs/adr/0033-notifikasi-backlog-selesai.md:53-54`

**Interfaces:**
- Consumes: `unlockNotifySound` dari Task 1.
- Produces: listener `pointerdown`/`keydown` (once) yang meng-unlock audio saat user pertama berinteraksi.

- [x] **Step 1: Import `unlockNotifySound`** di `NotificationsContext.tsx`

Ubah baris 5:
```ts
import { playNotifySound, unlockNotifySound, type NotifySound } from "./sound";
```

- [x] **Step 2: Pasang listener unlock di effect yang sudah ada** (`NotificationsContext.tsx`, effect di ~baris 60)

Ganti blok effect:
```ts
  React.useEffect(() => {
    void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    return () => clearInterval(t);
  }, [tick]);
```
menjadi:
```ts
  React.useEffect(() => {
    void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    // SPEC-192 · autoplay diblokir sampai user berinteraksi; unlock audio pada gestur pertama.
    const unlock = () => { unlockNotifySound(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { clearInterval(t); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, [tick]);
```

- [x] **Step 3: Typecheck + seluruh test app hijau**

Run: `pnpm --filter @hanoman/app typecheck && pnpm --filter @hanoman/app test`
Expected: PASS, nol error TS.

- [x] **Step 4: Update docs (commit yang sama)**

Di `internal/docs/frontend/frontend-implementation.md` ganti butir **Sound** (baris 234-236) menjadi:
```markdown
- **Sound**: WAV bundled di `src/public/sounds/notify-<kind>.wav`, dibangkitkan
  `scripts/gen-notify-sounds.mjs` (deterministik, in-repo). `playNotifySound(kind)` (`.../sound.ts`)
  memakai **satu** elemen `Audio` yang dipakai ulang; `unlockNotifySound()` meng-unlock elemen itu
  (prime muted→play→pause) pada **gestur user pertama** (listener `pointerdown`/`keydown` di
  `NotificationsProvider`), supaya bunyi dari poll timer tak ditolak autoplay (SPEC-192).
```

Di `internal/docs/adr/0033-notifikasi-backlog-selesai.md` ganti butir terakhir (baris 53-54) menjadi:
```markdown
- Autoplay sound bisa diblokir browser sebelum interaksi user. **SPEC-192**: satu elemen `Audio`
  dipakai ulang dan di-*unlock* (prime muted) pada gestur user pertama, sehingga notifikasi dari
  poll timer berbunyi setelah user berinteraksi minimal sekali (tombol Preview tetap memicu langsung).
```

- [x] **Step 5: Verifikasi nyata di local** — boot dev server, pastikan aset yang di-fetch benar-benar terjangkau

Run:
```bash
pnpm --filter @hanoman/app dev &   # vite di :5173
sleep 3
curl -sI http://localhost:5173/sounds/notify-short.wav | head -1   # HTTP 200
curl -sI http://localhost:5173/sounds/notify-alert.wav | head -1   # HTTP 200
```
Expected: dua-duanya `HTTP/1.1 200 OK` (path yang dipakai `playNotifySound` valid via dev server). Hentikan dev server setelahnya.

- [x] **Step 6: Commit**

```bash
git add src/src/notifications/NotificationsContext.tsx internal/docs/frontend/frontend-implementation.md internal/docs/adr/0033-notifikasi-backlog-selesai.md
git commit -m "fix(notif): unlock audio pada gestur user pertama + docs (SPEC-192)"
```

---

## Self-Review
- **Spec coverage:** unlock reused-element (Task 1) + wiring gestur pertama (Task 2) menutup satu-satunya akar masalah (autoplay blocked). Done & decision keduanya lewat `playNotifySound` yang sama → keduanya ikut ter-fix. ✓
- **Type consistency:** `unlockNotifySound(): void` dipakai identik di Task 1 (export) & Task 2 (import/panggil). `NotifySound` tak berubah. ✓
- **No placeholders:** semua step berisi kode/perintah nyata. ✓
