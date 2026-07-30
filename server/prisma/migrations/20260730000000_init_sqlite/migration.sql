-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "repoDir" TEXT,
    "gitRemote" TEXT,
    "stack" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    "ingestKeyHash" TEXT,
    "ingestKeyPrefix" TEXT,
    "helpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "schedulerOptIn" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ProjectLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromProjectId" TEXT NOT NULL,
    "toProjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectLink_fromProjectId_fkey" FOREIGN KEY ("fromProjectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectLink_toProjectId_fkey" FOREIGN KEY ("toProjectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Spec" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "payload" JSONB,
    "branchFrom" TEXT,
    "baseSha" TEXT,
    "headSha" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Spec_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "data" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'done',
    "key" TEXT,
    "specId" TEXT,
    "sessionId" TEXT,
    "title" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "user" TEXT NOT NULL,
    "keyPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "health" JSONB,
    "lastAuditAt" DATETIME,
    "audit" JSONB,
    "hardened" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VpsAuditSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vpsId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "results" JSONB NOT NULL,
    "scoreTotal" REAL NOT NULL,
    "scoreBySection" JSONB NOT NULL,
    "detected" JSONB,
    CONSTRAINT "VpsAuditSnapshot_vpsId_fkey" FOREIGN KEY ("vpsId") REFERENCES "Vps" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VpsItemState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vpsId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "na" BOOLEAN NOT NULL DEFAULT false,
    "naReason" TEXT,
    "attested" BOOLEAN NOT NULL DEFAULT false,
    "attestNote" TEXT,
    "actorEmail" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VpsItemState_vpsId_fkey" FOREIGN KEY ("vpsId") REFERENCES "Vps" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SessionResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "specId" TEXT,
    "oldStage" TEXT,
    "newStage" TEXT,
    "commitSha" TEXT,
    "branch" TEXT,
    "prUrl" TEXT,
    "status" TEXT NOT NULL,
    "deviceId" TEXT,
    "author" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SessionHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "specId" TEXT,
    "title" TEXT,
    "kind" TEXT NOT NULL,
    "flow" TEXT,
    "agent" TEXT NOT NULL,
    "model" TEXT,
    "effort" TEXT,
    "branch" TEXT,
    "cwd" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "exitCode" INTEGER,
    "transcriptKey" TEXT,
    "transcriptBytes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "deviceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LocalBinding" (
    "projectId" TEXT NOT NULL PRIMARY KEY,
    "repoDir" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "cursor" TEXT NOT NULL DEFAULT '0'
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "localData" JSONB NOT NULL,
    "localVersion" INTEGER NOT NULL,
    "localUpdatedAt" DATETIME NOT NULL,
    "serverData" JSONB NOT NULL,
    "serverVersion" INTEGER NOT NULL,
    "serverUpdatedAt" DATETIME NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SchedulerQueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "specId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sessionId" TEXT,
    "note" TEXT,
    "enqueuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "launchedAt" DATETIME
);

-- CreateTable
CREATE TABLE "RuntimeConfig" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ErrorGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sampleStack" TEXT,
    "sampleFrames" JSONB,
    "release" TEXT,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "specId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ErrorGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "frames" JSONB,
    "environment" TEXT NOT NULL,
    "release" TEXT,
    "context" JSONB,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErrorEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ErrorGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceMapArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "debugId" TEXT,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceMapArtifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "reporterEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "accessKeyHash" TEXT NOT NULL,
    "shareToken" TEXT,
    "specId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Ticket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProjectLink_toProjectId_idx" ON "ProjectLink"("toProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectLink_fromProjectId_toProjectId_key" ON "ProjectLink"("fromProjectId", "toProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_key_key" ON "Notification"("key");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "VpsAuditSnapshot_vpsId_createdAt_idx" ON "VpsAuditSnapshot"("vpsId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VpsItemState_vpsId_itemId_key" ON "VpsItemState"("vpsId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_tokenHash_key" ON "DeviceToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToken_tokenHash_key" ON "AgentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SessionHistory_projectId_startedAt_idx" ON "SessionHistory"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "SessionHistory_specId_idx" ON "SessionHistory"("specId");

-- CreateIndex
CREATE INDEX "SessionHistory_sessionId_idx" ON "SessionHistory"("sessionId");

-- CreateIndex
CREATE INDEX "SyncLog_entity_recordId_idx" ON "SyncLog"("entity", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncOutbox_entity_recordId_key" ON "SyncOutbox"("entity", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncConflict_entity_recordId_key" ON "SyncConflict"("entity", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulerQueueItem_specId_key" ON "SchedulerQueueItem"("specId");

-- CreateIndex
CREATE INDEX "SchedulerQueueItem_status_idx" ON "SchedulerQueueItem"("status");

-- CreateIndex
CREATE INDEX "ErrorGroup_projectId_lastSeenAt_idx" ON "ErrorGroup"("projectId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorGroup_projectId_fingerprint_key" ON "ErrorGroup"("projectId", "fingerprint");

-- CreateIndex
CREATE INDEX "ErrorEvent_groupId_receivedAt_idx" ON "ErrorEvent"("groupId", "receivedAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_projectId_receivedAt_idx" ON "ErrorEvent"("projectId", "receivedAt");

-- CreateIndex
CREATE INDEX "SourceMapArtifact_projectId_release_idx" ON "SourceMapArtifact"("projectId", "release");

-- CreateIndex
CREATE UNIQUE INDEX "SourceMapArtifact_projectId_release_filename_key" ON "SourceMapArtifact"("projectId", "release", "filename");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_accessKeyHash_key" ON "Ticket"("accessKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_shareToken_key" ON "Ticket"("shareToken");

-- CreateIndex
CREATE INDEX "Ticket_projectId_createdAt_idx" ON "Ticket"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_projectId_number_key" ON "Ticket"("projectId", "number");

-- CreateIndex
CREATE INDEX "TicketAttachment_ticketId_idx" ON "TicketAttachment"("ticketId");

