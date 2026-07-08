-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "installationId" INTEGER;

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "commitSha" TEXT,
ADD COLUMN     "reportRepo" TEXT;

-- CreateTable
CREATE TABLE "GithubInstallation" (
    "id" INTEGER NOT NULL,
    "account" TEXT NOT NULL,
    "repos" TEXT[],

    CONSTRAINT "GithubInstallation_pkey" PRIMARY KEY ("id")
);
