-- SPEC-213 · sync server-client (ADR-0043..0047)
ALTER TABLE "Project" ADD COLUMN "gitRemote" TEXT;
ALTER TABLE "Project" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Project" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Spec" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Spec" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Vps" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Vps" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "DeviceToken" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceToken_tokenHash_key" ON "DeviceToken"("tokenHash");
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SessionResult" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "specId" TEXT, "oldStage" TEXT,
  "newStage" TEXT, "commitSha" TEXT, "branch" TEXT, "prUrl" TEXT, "status" TEXT NOT NULL,
  "deviceId" TEXT, "author" TEXT, "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncLog" (
  "seq" BIGSERIAL NOT NULL, "entity" TEXT NOT NULL, "recordId" TEXT NOT NULL,
  "version" INTEGER NOT NULL, "data" JSONB NOT NULL, "deviceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("seq")
);
CREATE INDEX "SyncLog_entity_recordId_idx" ON "SyncLog"("entity", "recordId");

CREATE TABLE "LocalBinding" (
  "projectId" TEXT NOT NULL, "repoDir" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocalBinding_pkey" PRIMARY KEY ("projectId")
);

CREATE TABLE "SyncOutbox" (
  "id" TEXT NOT NULL, "entity" TEXT NOT NULL, "recordId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SyncOutbox_entity_recordId_key" ON "SyncOutbox"("entity", "recordId");

CREATE TABLE "SyncState" (
  "id" INTEGER NOT NULL DEFAULT 1, "cursor" TEXT NOT NULL DEFAULT '0',
  CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);
