import { describe, it, expect } from "vitest";
import {
  parseStartArgs, migrateFailureHint,
  planSupervisorStep, serverEnv, MAX_UPDATE_RESTARTS,
} from "../src/commands/start";
import { UPDATE_RESTART_EXIT } from "@hanoman/shared";

describe("parseStartArgs", () => {
  it("default: tanpa override, migrasi menyala", () => {
    expect(parseStartArgs([])).toEqual({ port: null, host: null, db: null, migrate: true });
  });
  it("--port --host --db", () => {
    expect(parseStartArgs(["--port", "9000", "--host", "0.0.0.0", "--db", "/tmp/a.db"]))
      .toEqual({ port: 9000, host: "0.0.0.0", db: "/tmp/a.db", migrate: true });
  });
  it("bentuk --port=9000 juga diterima", () => {
    expect(parseStartArgs(["--port=9000"]).port).toBe(9000);
  });
  it("--no-migrate", () => {
    expect(parseStartArgs(["--no-migrate"]).migrate).toBe(false);
  });
  it("--port bukan angka → melempar", () => {
    expect(() => parseStartArgs(["--port", "abc"])).toThrow(/--port/);
  });
  it("--host tanpa nilai → melempar, tak menelan flag berikutnya", () => {
    expect(() => parseStartArgs(["--host", "--no-migrate"])).toThrow(/--host/);
  });
  it("argumen tak dikenal → melempar", () => {
    expect(() => parseStartArgs(["--wat"])).toThrow(/--wat/);
  });
});

// SPEC-398 · Prisma membalas P3005 saat berkas DB sudah punya tabel tapi tak punya riwayat
// migrasi — terjadi nyata di `~/.hanoman/hanoman.db` milik prototipe hanoman lama (tabel
// `runs`/`meta`, nol baris). Pesan mentahnya menyuruh operator "baseline an existing production
// database", yang tak bisa ditindaklanjuti oleh orang yang baru `npm i -g hanoman`.
describe("migrateFailureHint", () => {
  const DB = "/Users/x/.hanoman/hanoman.db";

  it("P3005 → menjelaskan sebabnya dan memberi jalan keluar yang konkret", () => {
    const h = migrateFailureHint("Error: P3005\nThe database schema is not empty.", DB);
    expect(h).not.toBeNull();
    expect(h).toContain(DB);                    // sebut BERKAS mana yang bermasalah
    expect(h).toMatch(/bukan.*hanoman|prototipe|riwayat migrasi/i);
    expect(h).toMatch(/--db|HANOMAN_DATABASE_URL/); // cara memakai berkas lain
    expect(h).not.toMatch(/baseline/i);          // jangan teruskan jargon Prisma
  });

  it("kegagalan lain tidak dikarang-karang penjelasannya", () => {
    expect(migrateFailureHint("Error: P1001 can't reach database", DB)).toBeNull();
    expect(migrateFailureHint("", DB)).toBeNull();
  });
});

describe("planSupervisorStep (SPEC-405 · ADR-0088)", () => {
  it("exit 0 → keluar 0 (perilaku hari ini, tak berubah)", () => {
    expect(planSupervisorStep(0, 0)).toEqual({ action: "exit", code: 0 });
  });
  it("exit ≠ sentinel → keluar apa adanya, jangan pernah memasang apa pun", () => {
    for (const c of [1, 2, 130, 143]) expect(planSupervisorStep(c, 0)).toEqual({ action: "exit", code: c });
  });
  it("sentinel 75 → pasang lalu jalankan lagi", () => {
    expect(planSupervisorStep(UPDATE_RESTART_EXIT, 0)).toEqual({ action: "update" });
  });
  it("sentinel tapi jatah habis → keluar, bukan loop tak berujung", () => {
    expect(planSupervisorStep(UPDATE_RESTART_EXIT, MAX_UPDATE_RESTARTS))
      .toEqual({ action: "exit", code: UPDATE_RESTART_EXIT });
  });
  it("jatah masih sisa satu → masih memasang", () => {
    expect(planSupervisorStep(UPDATE_RESTART_EXIT, MAX_UPDATE_RESTARTS - 1)).toEqual({ action: "update" });
  });
});

describe("serverEnv (SPEC-405 · ADR-0088)", () => {
  const base = { dbUrl: "file:/tmp/x.db", port: 8787, host: "127.0.0.1", home: "/home/u/.hanoman", web: null };
  it("menandai proses anak sebagai TERSUPERVISI — tanpa ini tombol update tak muncul", () => {
    expect(serverEnv(base).HANOMAN_SUPERVISOR).toBe("1");
  });
  it("meneruskan env terhitung yang sudah ada", () => {
    expect(serverEnv(base)).toMatchObject({
      NODE_ENV: "production", DATABASE_URL: "file:/tmp/x.db",
      PORT: "8787", HOST: "127.0.0.1", HANOMAN_HOME: "/home/u/.hanoman",
    });
  });
  it("HANOMAN_WEB_DIR hanya bila aset web ketemu", () => {
    expect(serverEnv(base).HANOMAN_WEB_DIR).toBeUndefined();
    expect(serverEnv({ ...base, web: "/pkg/web" }).HANOMAN_WEB_DIR).toBe("/pkg/web");
  });
});
