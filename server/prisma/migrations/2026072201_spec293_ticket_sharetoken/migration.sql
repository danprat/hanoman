-- SPEC-293 · token bagikan link status publik tiket (additif, nullable)
ALTER TABLE "Ticket" ADD COLUMN "shareToken" TEXT;
CREATE UNIQUE INDEX "Ticket_shareToken_key" ON "Ticket"("shareToken");
