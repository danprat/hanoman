-- SPEC-476 · ADR-0096 · durable, local-only Telegram gateway state.
-- Deliberately no foreign keys: project/session references may disappear while dedupe/audit remains.
-- Deliberately no credentials or inbound message body.
CREATE TABLE "TelegramGatewayState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "offset" INTEGER NOT NULL DEFAULT 0,
    "botUsername" TEXT,
    "lastUpdateAt" DATETIME,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "TelegramChat" (
    "chatId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "activeProjectId" TEXT,
    "activeSessionId" TEXT,
    "personalityAgentId" TEXT,
    "summary" TEXT,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "lastProgressKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "TelegramChat_userId_key" ON "TelegramChat"("userId");

CREATE TABLE "TelegramUpdate" (
    "updateId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'received',
    "rejectReason" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" DATETIME,
    "dispatchedAt" DATETIME
);

CREATE INDEX "TelegramUpdate_userId_receivedAt_idx" ON "TelegramUpdate"("userId", "receivedAt");
CREATE INDEX "TelegramUpdate_state_idx" ON "TelegramUpdate"("state");

CREATE TABLE "TelegramMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "TelegramMemory_chatId_createdAt_idx" ON "TelegramMemory"("chatId", "createdAt");

CREATE TABLE "TelegramOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "updateId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "confirmationId" TEXT,
    "telegramMessageId" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" DATETIME,
    "sentAt" DATETIME
);

CREATE UNIQUE INDEX "TelegramOutbox_dedupeKey_key" ON "TelegramOutbox"("dedupeKey");
CREATE INDEX "TelegramOutbox_state_createdAt_idx" ON "TelegramOutbox"("state", "createdAt");
CREATE INDEX "TelegramOutbox_chatId_createdAt_idx" ON "TelegramOutbox"("chatId", "createdAt");

CREATE TABLE "TelegramConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "callbackToken" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "updateId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "usedAt" DATETIME
);

CREATE UNIQUE INDEX "TelegramConfirmation_callbackToken_key" ON "TelegramConfirmation"("callbackToken");
CREATE INDEX "TelegramConfirmation_chatId_state_idx" ON "TelegramConfirmation"("chatId", "state");
CREATE INDEX "TelegramConfirmation_expiresAt_idx" ON "TelegramConfirmation"("expiresAt");

CREATE TABLE "TelegramAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT,
    "userId" TEXT,
    "updateId" INTEGER,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "correlationId" TEXT,
    "method" TEXT,
    "path" TEXT,
    "statusCode" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "TelegramAudit_chatId_createdAt_idx" ON "TelegramAudit"("chatId", "createdAt");
CREATE INDEX "TelegramAudit_updateId_idx" ON "TelegramAudit"("updateId");
