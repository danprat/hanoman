import "./env";
import Redis from "ioredis";
const url = process.env.REDIS_URL ?? "redis://localhost:6379";
// BullMQ needs maxRetriesPerRequest: null; pub/sub needs *separate* connections
// (a subscribed client can't issue other commands), so publisher()/subscriber()
// mint fresh ioredis instances per caller.
//
// `db` harus ikut: tanpanya BullMQ selalu memakai db 0 apa pun isi REDIS_URL, jadi
// mengarahkan antrean ke tempat lain — misal db terpisah untuk test — diam-diam gagal
// dan worker dev melahap job test sebagai run sungguhan.
const u = new URL(url);
export const bullConnection = {
  host: u.hostname, port: Number(u.port || 6379), db: Number(u.pathname.slice(1) || 0),
  maxRetriesPerRequest: null as null,
};

// Antrean dev ada di db 0, dan worker dev melahap apa pun yang mendarat di sana — sebuah
// job dari test berarti worktree dan proses `claude` sungguhan. Tidak ada test yang boleh
// menjalankan run nyata: kalau isolasi Redis meleset, gagal keras di sini, bukan diam-diam
// menyalakan run. Lihat server/vitest.config.ts.
if (process.env.NODE_ENV === "test" && bullConnection.db === 0)
  throw new Error("redis: test dilarang memakai db 0 — worker dev mendengarkan di sana. Setel TEST_REDIS_URL / REDIS_URL ke db lain.");
export const publisher = () => new Redis(url);
export const subscriber = () => new Redis(url);
