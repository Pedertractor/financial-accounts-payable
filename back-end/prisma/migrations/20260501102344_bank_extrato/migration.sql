-- CreateEnum
CREATE TYPE "BankExtratoMatchKind" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "BankExtratoImport" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "originalFileName" TEXT NOT NULL,
    "storagePath" TEXT,
    "referenceDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankExtratoImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankExtratoLine" (
    "id" TEXT NOT NULL,
    "extratoImportId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "beneficiaryRaw" TEXT NOT NULL,
    "beneficiaryNorm" TEXT,
    "documentNumberRaw" TEXT,
    "paymentNumberRaw" TEXT,
    "clientNumberRaw" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentTypeRaw" TEXT,
    "statusRaw" TEXT,
    "channelRaw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankExtratoLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankExtratoSuggestionMatch" (
    "id" TEXT NOT NULL,
    "extratoImportId" TEXT NOT NULL,
    "extratoLineId" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "matchKind" "BankExtratoMatchKind" NOT NULL,
    "justification" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankExtratoSuggestionMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankExtratoImport_runId_idx" ON "BankExtratoImport"("runId");

-- CreateIndex
CREATE INDEX "BankExtratoImport_uploadedById_idx" ON "BankExtratoImport"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "BankExtratoImport_runId_referenceDate_key" ON "BankExtratoImport"("runId", "referenceDate");

-- CreateIndex
CREATE INDEX "BankExtratoLine_extratoImportId_idx" ON "BankExtratoLine"("extratoImportId");

-- CreateIndex
CREATE INDEX "BankExtratoLine_amount_idx" ON "BankExtratoLine"("amount");

-- CreateIndex
CREATE INDEX "BankExtratoLine_beneficiaryNorm_idx" ON "BankExtratoLine"("beneficiaryNorm");

-- CreateIndex
CREATE UNIQUE INDEX "BankExtratoSuggestionMatch_extratoLineId_key" ON "BankExtratoSuggestionMatch"("extratoLineId");

-- CreateIndex
CREATE INDEX "BankExtratoSuggestionMatch_extratoImportId_idx" ON "BankExtratoSuggestionMatch"("extratoImportId");

-- CreateIndex
CREATE INDEX "BankExtratoSuggestionMatch_suggestionId_idx" ON "BankExtratoSuggestionMatch"("suggestionId");

-- CreateIndex
CREATE UNIQUE INDEX "BankExtratoSuggestionMatch_extratoImportId_suggestionId_key" ON "BankExtratoSuggestionMatch"("extratoImportId", "suggestionId");

-- AddForeignKey
ALTER TABLE "BankExtratoImport" ADD CONSTRAINT "BankExtratoImport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankExtratoImport" ADD CONSTRAINT "BankExtratoImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankExtratoLine" ADD CONSTRAINT "BankExtratoLine_extratoImportId_fkey" FOREIGN KEY ("extratoImportId") REFERENCES "BankExtratoImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankExtratoSuggestionMatch" ADD CONSTRAINT "BankExtratoSuggestionMatch_extratoImportId_fkey" FOREIGN KEY ("extratoImportId") REFERENCES "BankExtratoImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankExtratoSuggestionMatch" ADD CONSTRAINT "BankExtratoSuggestionMatch_extratoLineId_fkey" FOREIGN KEY ("extratoLineId") REFERENCES "BankExtratoLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankExtratoSuggestionMatch" ADD CONSTRAINT "BankExtratoSuggestionMatch_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "MatchSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
