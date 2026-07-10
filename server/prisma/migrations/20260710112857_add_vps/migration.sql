-- CreateTable
CREATE TABLE "Vps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "user" TEXT NOT NULL,
    "keyPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "health" JSONB,
    "lastAuditAt" TIMESTAMP(3),
    "audit" JSONB,
    "hardened" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Vps_pkey" PRIMARY KEY ("id")
);
