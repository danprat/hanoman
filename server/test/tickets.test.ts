import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { createTicket } from "../src/services/ticket";
import { saveUpload } from "../src/services/uploads";

const app = buildApp({ requireAuth: false });

const clean = async () => {
  await prisma.ticketAttachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

let tId = "";
beforeAll(async () => {
  await app.ready();
  await clean();
  await prisma.project.create({ data: { id: "tri-proj", name: "Tri", desc: "", kind: "existing", helpEnabled: false } });
  await prisma.project.create({ data: { id: "tri-other", name: "Other", desc: "", kind: "existing", helpEnabled: true } });
  const { ticket } = await createTicket({ projectId: "tri-proj", category: "bug", title: "X rusak", detail: "detail keluhan", reporterEmail: "r@e.co" });
  tId = ticket.id;
  // tiket project lain (isolasi)
  await createTicket({ projectId: "tri-other", category: "fitur", title: "minta fitur", detail: "d", reporterEmail: "o@e.co" });
});
afterAll(async () => { await clean(); await app.close(); });

describe("SPEC-253 · manajemen Help Center per project", () => {
  it("enable → GET → disable, publicUrl memuat slug", async () => {
    const en = await app.inject({ method: "POST", url: "/api/projects/tri-proj/help-center" });
    expect(en.statusCode).toBe(200);
    expect(en.json().enabled).toBe(true);
    expect(en.json().publicUrl).toContain("/help/tri-proj");
    expect((await app.inject({ method: "GET", url: "/api/projects/tri-proj/help-center" })).json().enabled).toBe(true);
    const dis = await app.inject({ method: "DELETE", url: "/api/projects/tri-proj/help-center" });
    expect(dis.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/projects/tri-proj/help-center" })).json().enabled).toBe(false);
  });
  it("help-center project tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/tak-ada/help-center" })).statusCode).toBe(404);
  });
});

describe("SPEC-253 · triase tiket", () => {
  it("list ber-scope project + unreviewed", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tickets?project=tri-proj" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBe(1); // isolasi: tiket project lain tak muncul
    expect(body.items[0].projectId).toBe("tri-proj");
    expect(body.unreviewed).toBe(1);
  });

  it("detail memuat isi + attachments", async () => {
    const res = await app.inject({ method: "GET", url: `/api/tickets/${tId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().detail).toBe("detail keluhan");
    expect(Array.isArray(res.json().attachments)).toBe(true);
  });

  it("serve lampiran ber-auth; att bukan milik tiket → 404", async () => {
    const { storageKey, size } = await saveUpload(Buffer.from("IMG"), "image/png");
    const att = await prisma.ticketAttachment.create({ data: { ticketId: tId, projectId: "tri-proj", filename: "s.png", mimeType: "image/png", size, storageKey } });
    const ok = await app.inject({ method: "GET", url: `/api/tickets/${tId}/attachments/${att.id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("image/png");
    // att id benar tapi ticket id salah → 404 (att bukan milik tiket itu)
    expect((await app.inject({ method: "GET", url: `/api/tickets/bogus/attachments/${att.id}` })).statusCode).toBe(404);
  });

  it("accept → Spec source help + tautan dua arah + idempoten", async () => {
    const res = await app.inject({ method: "POST", url: `/api/tickets/${tId}/accept`, payload: { priority: "tinggi" } });
    expect(res.statusCode).toBe(201);
    const spec = res.json().spec;
    expect(spec.source).toBe("help");
    expect(spec.priority).toBe("tinggi");
    expect(spec.stage).toBe("brainstorming");
    expect(spec.payload.context).toContain("Dari tiket Help Center #");
    const t = await prisma.ticket.findUnique({ where: { id: tId } });
    expect(t?.status).toBe("accepted");
    expect(t?.specId).toBe(spec.id);
    // idempoten: accept kedua tak membuat Spec dobel
    const again = await app.inject({ method: "POST", url: `/api/tickets/${tId}/accept` });
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyPromoted).toBe(true);
    expect(again.json().spec.id).toBe(spec.id);
  });

  it("reject → status rejected, tanpa Spec", async () => {
    const { ticket } = await createTicket({ projectId: "tri-proj", category: "lainnya", title: "spam", detail: "d", reporterEmail: "s@s.s" });
    const before = await prisma.spec.count({ where: { projectId: "tri-proj" } });
    const res = await app.inject({ method: "POST", url: `/api/tickets/${ticket.id}/reject` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
    expect(await prisma.spec.count({ where: { projectId: "tri-proj" } })).toBe(before);
  });

  it("tiket tak dikenal → 404", async () => {
    expect((await app.inject({ method: "GET", url: "/api/tickets/tak-ada" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/tickets/tak-ada/accept" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/tickets/tak-ada/reject" })).statusCode).toBe(404);
  });
});
