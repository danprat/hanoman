import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { prisma } from "../db";
import { zCreateVps, zPatchVps, type VpsCheck } from "@hanoman/shared";
import { sshExec, consoleArgv } from "../services/vps-ssh";
import { runAudit, scriptPath } from "../services/vps-audit";
import { bootstrapKey } from "../services/vps-bootstrap";
import { createSession } from "../services/pty";
import { sessionModel } from "../services/settings";
import { enqueueOutbox } from "../services/outbox";

// Audit (dan nanti harden/session) = eksekusi remote via SSH dengan key milik mesin ini.
// Tanpa auth — pagarnya bind 127.0.0.1 di server.ts, sama seperti /api/terminal
// (lihat komentar routes/terminal.ts). Bila HOST dibuka, gembok route ini bersamanya.
export default async function (app: FastifyInstance) {
  app.get("/vps", async () => prisma.vps.findMany({ orderBy: { createdAt: "asc" } }));

  // `password` transien (SPEC-165): dipakai memasang key hanoman, lalu hilang bersama
  // request ini. Bootstrap dijalankan SEBELUM baris lahir — gagal berarti tak ada sampah.
  app.post("/vps", async (req, reply) => {
    const p = zCreateVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const { password, ...data } = p.data;
    if (password) {
      const bs = await bootstrapKey({ host: data.host, port: data.port, user: data.user }, password);
      if (!bs.ok) return reply.code(502).send({ error: "bootstrap key gagal lewat ssh", out: bs.out });
      data.keyPath = bs.keyPath;
    }
    const created = await prisma.vps.create({ data });
    await enqueueOutbox("vps", created.id); // SPEC-213 · antre push sync (tanpa keyPath)
    return reply.code(201).send(created);
  });

  app.patch("/vps/:id", async (req, reply) => {
    const p = zPatchVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const { id } = req.params as { id: string };
    const { password, ...data } = p.data;
    const current = await prisma.vps.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: "not found" });
    if (password) {
      // Bootstrap ulang memakai nilai SESUDAH patch: mengganti host & password sekaligus harus bekerja.
      const bs = await bootstrapKey({
        host: data.host ?? current.host, port: data.port ?? current.port, user: data.user ?? current.user,
      }, password);
      if (!bs.ok) return reply.code(502).send({ error: "bootstrap key gagal lewat ssh", out: bs.out });
      data.keyPath = bs.keyPath;
    }
    const updated = await prisma.vps.update({ where: { id }, data });
    await enqueueOutbox("vps", id); // SPEC-213 · antre push sync
    return updated;
  });

  app.delete("/vps/:id", async (req, reply) => {
    try {
      await prisma.vps.delete({ where: { id: (req.params as { id: string }).id } });
      return reply.code(204).send();
    } catch { return reply.code(404).send({ error: "not found" }); }
  });

  app.post("/vps/:id/audit", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const r = await runAudit(v);
    if (!r.ok) return reply.code(502).send({ error: "audit gagal lewat ssh", out: r.out });
    return { audit: r.audit, hardened: r.hardened };
  });

  // Harden TIDAK PERNAH terjadwal — hanya dari tombol (SPEC-164 §5). Urutan anti-lockout:
  // apply (script sendiri allow port SSH sebelum enable firewall + sshd -t sebelum reload)
  // → verifikasi lewat KONEKSI BARU → audit ulang supaya status di list langsung jujur.
  app.post("/vps/:id/harden", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    // SSH_USER menentukan PermitRootLogin no vs prohibit-password; user/port sudah
    // divalidasi zod (trust boundary di zCreateVps), aman dirangkai ke perintah.
    const r = await sshExec(v, `sudo -n env SSH_PORT=${v.port} SSH_USER=${v.user} bash -s`,
      { stdin: readFileSync(scriptPath("harden.sh"), "utf8"), timeoutMs: 300_000 });
    if (r.code !== 0) return reply.code(502).send({ error: "harden gagal lewat ssh", transcript: r.out });
    const verify = await sshExec(v, "true", { timeoutMs: 30_000 });
    if (verify.code !== 0) {
      return reply.code(502).send({
        error: "verifikasi koneksi pasca-harden gagal — periksa akses ssh secara manual",
        transcript: r.out, verify: verify.out });
    }
    const audit = await runAudit(v);
    return { transcript: r.out, audit: audit.ok ? audit.audit : null, hardened: audit.ok && audit.hardened };
  });

  // SPEC-211 · test connection — cek ssh key-only berhasil sekarang. Transien, tak sentuh DB.
  // Gagal koneksi bukan error HTTP: 200 { ok:false, out } supaya UI bisa menampilkan transcript.
  app.post("/vps/:id/test", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const r = await sshExec(v, "true", { timeoutMs: 15_000 });
    return { ok: r.code === 0, out: r.out };
  });

  // SPEC-211 · Open Console — shell ssh MENTAH (bukan claude) di dalam tmux hanoman (ADR-0042).
  // id deterministik: tekan Console dua kali menyambung, bukan menumpuk sesi ssh.
  app.post("/vps/:id/console", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const s = createSession(`vps-console:${v.id}`, homedir(), { id: `vpsc-${v.id}`, command: consoleArgv(v) });
    return reply.code(201).send({ id: s.id });
  });

  // Escape hatch (SPEC-164 §6): kasus yang script tak tangani dikerjakan Claude interaktif.
  // cwd = home server (bukan repo siapa pun); konteks + perintah ssh dibawa prompt awal.
  app.post("/vps/:id/session", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const checks = (v.audit as VpsCheck[] | null) ?? [];
    const { model, effort } = await sessionModel();
    const s = createSession(`vps:${v.id}`, homedir(), {
      model, effort,
      prompt: [
        `Kamu membantu hardening lanjutan VPS "${v.name}" (${v.user}@${v.host} port ${v.port}).`,
        `Akses: ssh -p ${v.port}${v.keyPath ? ` -i ${v.keyPath}` : ""} ${v.user}@${v.host}`,
        checks.length ? "Hasil audit terakhir:" : "Belum pernah diaudit.",
        ...checks.map((c) => `- ${c.check}: ${c.status}${c.detail ? ` (${c.detail})` : ""}`),
        "Kerjakan hanya yang diminta lewat terminal ini; konfirmasi dulu sebelum perubahan berisiko.",
      ].join("\n"),
    });
    return reply.code(201).send({ id: s.id });
  });
}
