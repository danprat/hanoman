import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { prisma } from "../db";
import { zCreateVps, zPatchVps, type VpsCheck } from "@hanoman/shared";
import { sshExec } from "../services/vps-ssh";
import { runAudit, scriptPath } from "../services/vps-audit";
import { createSession } from "../services/pty";
import { sessionModel } from "../services/settings";

// Audit (dan nanti harden/session) = eksekusi remote via SSH dengan key milik mesin ini.
// Tanpa auth — pagarnya bind 127.0.0.1 di server.ts, sama seperti /api/terminal
// (lihat komentar routes/terminal.ts). Bila HOST dibuka, gembok route ini bersamanya.
export default async function (app: FastifyInstance) {
  app.get("/vps", async () => prisma.vps.findMany({ orderBy: { createdAt: "asc" } }));

  app.post("/vps", async (req, reply) => {
    const p = zCreateVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    return reply.code(201).send(await prisma.vps.create({ data: p.data }));
  });

  app.patch("/vps/:id", async (req, reply) => {
    const p = zPatchVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try { return await prisma.vps.update({ where: { id: (req.params as { id: string }).id }, data: p.data }); }
    catch { return reply.code(404).send({ error: "not found" }); }
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
