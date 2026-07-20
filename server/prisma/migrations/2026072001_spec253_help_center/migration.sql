-- SPEC-253 · ADR-0062 · Help Center per project (Ticket + TicketAttachment + Project.helpEnabled)
ALTER TABLE "Project" ADD COLUMN "helpEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Ticket" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "reporterEmail" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "accessKeyHash" TEXT NOT NULL,
  "specId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Ticket_accessKeyHash_key" ON "Ticket"("accessKeyHash");
CREATE UNIQUE INDEX "Ticket_projectId_number_key" ON "Ticket"("projectId", "number");
CREATE INDEX "Ticket_projectId_createdAt_idx" ON "Ticket"("projectId", "createdAt");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TicketAttachment" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TicketAttachment_ticketId_idx" ON "TicketAttachment"("ticketId");
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
