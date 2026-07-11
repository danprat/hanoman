-- SPEC-184 · Notification untuk human decision.
ALTER TABLE "Notification" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'done';
ALTER TABLE "Notification" ADD COLUMN "key" TEXT;
ALTER TABLE "Notification" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "Notification" ALTER COLUMN "specId" DROP NOT NULL;
UPDATE "Notification" SET "key" = 'done:' || "specId" WHERE "key" IS NULL AND "specId" IS NOT NULL;
DROP INDEX "Notification_specId_key";
CREATE UNIQUE INDEX "Notification_key_key" ON "Notification"("key");
