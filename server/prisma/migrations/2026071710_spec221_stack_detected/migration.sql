-- SPEC-221 · ADR-0051 · deteksi stack app-layer (advisory) di snapshot (additive).
ALTER TABLE "VpsAuditSnapshot" ADD COLUMN "detected" JSONB;
