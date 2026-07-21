-- SPEC-268 · ADR-0066 · ErrorGroup & Ticket masuk record-sync (version-stamp, ADR-0045)
ALTER TABLE "ErrorGroup" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ticket" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
