-- AlterTable
ALTER TABLE "FileUpload" ADD COLUMN "totalRowsSkipped" INTEGER,
ADD COLUMN "totalRowsUpdated" INTEGER;

-- AlterTable
ALTER TABLE "BankRecord" ADD COLUMN "importIdentityKey" TEXT;

-- AlterTable
ALTER TABLE "InternalRecord" ADD COLUMN "importIdentityKey" TEXT;

-- CreateIndex
CREATE INDEX "BankRecord_runId_importIdentityKey_idx" ON "BankRecord"("runId", "importIdentityKey");

-- CreateIndex
CREATE INDEX "InternalRecord_runId_importIdentityKey_idx" ON "InternalRecord"("runId", "importIdentityKey");
