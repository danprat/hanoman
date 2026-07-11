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
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {}); // jsdom tak implement pause
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
    expect(instances[1]!.src).toMatch(/\/sounds\/notify-alert\.wav$/);
  });

  it("unlockNotifySound: prime muted, sekali, idempoten", async () => {
    const { unlockNotifySound } = await import("../src/notifications/sound");
    unlockNotifySound();
    unlockNotifySound();
    expect(play).toHaveBeenCalledTimes(1);
    expect(mutedAtPlay[0]).toBe(true); // klik pertama user tak berbunyi kaget
  });
});
