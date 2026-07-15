-- SPEC-215 · ADR-0049 · config runtime store (local-only, tak disync)
CREATE TABLE "RuntimeConfig" (
  "key"       TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuntimeConfig_pkey" PRIMARY KEY ("key")
);
