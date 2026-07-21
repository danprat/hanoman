-- SPEC-272 · ADR-0068 · lampiran tiket masuk record-sync (metadata; biner lazy-fetch)
ALTER TABLE "TicketAttachment" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TicketAttachment" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
