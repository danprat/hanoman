// SPEC-253 · ADR-0062 · kapabilitas penyimpanan berkas (lampiran tiket Help Center).
// Berkas hidup di HANOMAN_UPLOAD_DIR — server-local, DI LUAR repoDir, TAK disync (cermin Vps.keyPath
// yang juga berkas di server, tak pernah di DB). Nama berkas opaque (uuid+ext); nama asli metadata saja.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { effectiveStr } from "../config";

const EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
export function extFor(mimeType: string): string {
  return EXT[mimeType] ?? ".bin";
}

export function uploadDir(): string {
  return resolve(effectiveStr("HANOMAN_UPLOAD_DIR") ?? join(process.cwd(), "data", "uploads"));
}

export async function saveUpload(buf: Buffer, mimeType: string): Promise<{ storageKey: string; size: number }> {
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const storageKey = `${randomUUID()}${extFor(mimeType)}`;
  await writeFile(join(dir, storageKey), buf);
  return { storageKey, size: buf.length };
}

// storageKey selalu dari saveUpload (uuid+ext, bukan input user) → tanpa traversal; basename-kan
// sebagai jaring pengaman ekstra sebelum menyentuh disk.
export async function readUpload(storageKey: string): Promise<Buffer> {
  const safe = storageKey.replace(/[/\\]/g, "");
  return readFile(join(uploadDir(), safe));
}

// SPEC-272 · ADR-0068 · fetch-through lampiran: baca lokal; bila absen & instance ini CLIENT sync
// (SYNC_SERVER_URL+SYNC_DEVICE_TOKEN), tarik byte dari hub lalu cache ke upload dir. Di hub
// (SYNC_SERVER_URL kosong) tak ada fetch → perilaku sama seperti readUpload.
export async function readUploadOrFetch(storageKey: string): Promise<Buffer> {
  const safe = storageKey.replace(/[/\\]/g, "");
  const target = join(uploadDir(), safe);
  try {
    return await readFile(target);
  } catch {
    const base = effectiveStr("SYNC_SERVER_URL");
    const token = effectiveStr("SYNC_DEVICE_TOKEN");
    if (!base || !token) throw new Error(`lampiran ${safe} tak ada lokal & bukan client sync`);
    const res = await fetch(`${base.replace(/\/$/, "")}/api/sync/attachments/${encodeURIComponent(safe)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`fetch lampiran hub gagal: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(uploadDir(), { recursive: true });
    await writeFile(target, buf); // cache lokal untuk pembukaan berikutnya
    return buf;
  }
}
export async function deleteUpload(storageKey: string): Promise<void> {
  const safe = storageKey.replace(/[/\\]/g, "");
  await unlink(join(uploadDir(), safe)).catch(() => { /* sudah tak ada */ });
}
