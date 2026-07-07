-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "repoDir" TEXT,
    "repoUrl" TEXT,
    "stack" TEXT NOT NULL DEFAULT '',
    "docStatus" TEXT NOT NULL,
    "coverage" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Spec" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "payload" JSONB,

    CONSTRAINT "Spec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "specId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggerDetail" TEXT NOT NULL,
    "phases" JSONB NOT NULL,
    "plan" JSONB NOT NULL,
    "files" JSONB NOT NULL,
    "log" JSONB NOT NULL,
    "worktree" TEXT NOT NULL,
    "branchFrom" TEXT NOT NULL,
    "branchTo" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" TEXT NOT NULL,
    "tokensOut" TEXT NOT NULL,
    "cost" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trigger" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "Trigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocFile" (
    "id" SERIAL NOT NULL,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "linked" BOOLEAN NOT NULL,
    "root" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DocFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocFile_projectId_path_key" ON "DocFile"("projectId", "path");

-- AddForeignKey
ALTER TABLE "Spec" ADD CONSTRAINT "Spec_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trigger" ADD CONSTRAINT "Trigger_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocFile" ADD CONSTRAINT "DocFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
