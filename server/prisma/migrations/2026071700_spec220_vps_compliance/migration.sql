-- SPEC-220 · ADR-0050 · kerangka kepatuhan VPS (additive).
CREATE TABLE "VpsAuditSnapshot" (
    "id" TEXT NOT NULL,
    "vpsId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "results" JSONB NOT NULL,
    "scoreTotal" DOUBLE PRECISION NOT NULL,
    "scoreBySection" JSONB NOT NULL,
    CONSTRAINT "VpsAuditSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VpsAuditSnapshot_vpsId_createdAt_idx" ON "VpsAuditSnapshot"("vpsId", "createdAt");
ALTER TABLE "VpsAuditSnapshot" ADD CONSTRAINT "VpsAuditSnapshot_vpsId_fkey"
    FOREIGN KEY ("vpsId") REFERENCES "Vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "VpsItemState" (
    "id" TEXT NOT NULL,
    "vpsId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "na" BOOLEAN NOT NULL DEFAULT false,
    "naReason" TEXT,
    "attested" BOOLEAN NOT NULL DEFAULT false,
    "attestNote" TEXT,
    "actorEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VpsItemState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VpsItemState_vpsId_itemId_key" ON "VpsItemState"("vpsId", "itemId");
ALTER TABLE "VpsItemState" ADD CONSTRAINT "VpsItemState_vpsId_fkey"
    FOREIGN KEY ("vpsId") REFERENCES "Vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
