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
export async function deleteUpload(storageKey: string): Promise<void> {
  const safe = storageKey.replace(/[/\\]/g, "");
  await unlink(join(uploadDir(), safe)).catch(() => { /* sudah tak ada */ });
}
