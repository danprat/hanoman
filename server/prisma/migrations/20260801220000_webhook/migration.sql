-- SPEC-481 · ADR-0100 · webhook keluar: endpoint + antrean/riwayat pengiriman.
--
-- Dua tabel BARU → `CREATE TABLE` polos; tak ada redefinisi tabel seperti migration SPEC-408.
-- Keduanya LOCAL-only (tanpa kolom `version`): barisnya memegang secret dan menunjuk pengiriman
-- dari mesin ini.
CREATE TABLE "WebhookEndpoint" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "name"           TEXT NOT NULL,
    "url"            TEXT NOT NULL,
    "secret"         TEXT NOT NULL,
    "events"         JSONB NOT NULL,
    "projectIds"     JSONB,
    "enabled"        BOOLEAN NOT NULL DEFAULT true,
    "allowPrivate"   BOOLEAN NOT NULL DEFAULT false,
    "apiVersion"     INTEGER NOT NULL DEFAULT 1,
    "maxPerMinute"   INTEGER NOT NULL DEFAULT 60,
    "disabledAt"     DATETIME,
    "disabledReason" TEXT,
    "lastSuccessAt"  DATETIME,
    "lastFailureAt"  DATETIME,
    "failureStreak"  INTEGER NOT NULL DEFAULT 0,
    "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      DATETIME NOT NULL
);

CREATE TABLE "WebhookDelivery" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "endpointId"    TEXT NOT NULL,
    "eventId"       TEXT NOT NULL,
    "eventType"     TEXT NOT NULL,
    "projectId"     TEXT,
    "payload"       JSONB NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "attempt"       INTEGER NOT NULL DEFAULT 0,
    "maxAttempts"   INTEGER NOT NULL DEFAULT 6,
    "nextAttemptAt" DATETIME,
    "httpStatus"    INTEGER,
    "durationMs"    INTEGER,
    "error"         TEXT,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt"        DATETIME,
    CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId")
        REFERENCES "WebhookEndpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery" ("status", "nextAttemptAt");
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery" ("endpointId", "createdAt");
CREATE INDEX "WebhookDelivery_eventId_idx" ON "WebhookDelivery" ("eventId");
