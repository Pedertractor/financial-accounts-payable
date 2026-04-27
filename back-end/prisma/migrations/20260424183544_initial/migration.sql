-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('BANK', 'INTERNAL');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('RECEIVED', 'VALIDATING', 'PARSING', 'IMPORTING', 'COMPLETED', 'PARTIAL_SUCCESS', 'AWAITING_CONFIRM', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "TriageBucket" AS ENUM ('PAY', 'VERIFY', 'BANK_ONLY', 'INTERNAL_ONLY');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "PaymentVinculoKind" AS ENUM ('PIX', 'TED');

-- CreateEnum
CREATE TYPE "SuggestionReason" AS ENUM ('EXACT_NAME_VALUE', 'FUZZY_NAME_MATCH', 'VALUE_ONLY', 'MULTIPLE_CANDIDATES', 'AGGREGATED_CANDIDATE', 'NO_INTERNAL_MATCH', 'NO_BANK_MATCH', 'PIX_CANDIDATE', 'TED_CANDIDATE', 'PIX_VINCULO_OK', 'TED_VINCULO_OK', 'MANUAL_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "ReconciliationType" AS ENUM ('EXACT', 'MANUAL', 'AGGREGATED', 'VALUE_ONLY_CONFIRMED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_PAID', 'PAID', 'PARTIALLY_PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('PEDERTRACTOR', 'TRACTOR');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('FINANCIAL', 'ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "UnitType" NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstLogin" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "unit" "UnitType" NOT NULL,
    "title" TEXT,
    "referenceStartDate" TIMESTAMP(3),
    "referenceEndDate" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileUpload" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "uploadedById" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'RECEIVED',
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT,
    "storagePath" TEXT,
    "mimeType" TEXT,
    "fileExtension" TEXT,
    "fileSizeBytes" INTEGER,
    "fileHash" TEXT,
    "workbookSheetCount" INTEGER,
    "selectedSheetName" TEXT,
    "startedAt" TIMESTAMP(3),
    "parsingStartedAt" TIMESTAMP(3),
    "parsingFinishedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "parseDurationMs" INTEGER,
    "importDurationMs" INTEGER,
    "totalDurationMs" INTEGER,
    "totalRowsDetected" INTEGER,
    "totalRowsRead" INTEGER,
    "totalRowsImported" INTEGER,
    "totalRowsRejected" INTEGER,
    "totalRowsWithWarnings" INTEGER,
    "headerRowIndex" INTEGER,
    "detectedColumnsJson" JSONB,
    "mappingColumnsJson" JSONB,
    "parserVersion" TEXT,
    "importVersion" TEXT,
    "errorMessage" TEXT,
    "errorDetailsJson" JSONB,
    "warningDetailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankRecord" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fileUploadId" TEXT,
    "rowNumber" INTEGER,
    "dueDate" TIMESTAMP(3),
    "beneficiaryNameRaw" TEXT NOT NULL,
    "beneficiaryNameNorm" TEXT,
    "beneficiaryNameCanon" TEXT,
    "payerNameRaw" TEXT,
    "nossoNumero" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalRecord" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fileUploadId" TEXT,
    "rowNumber" INTEGER,
    "dueDate" TIMESTAMP(3),
    "issueDate" TIMESTAMP(3),
    "supplierCode" INTEGER,
    "supplierNameRaw" TEXT NOT NULL,
    "supplierNameNorm" TEXT,
    "supplierNameCanon" TEXT,
    "walletCode" TEXT,
    "branchCode" TEXT,
    "invoiceNumber" TEXT,
    "installment" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "amountPaid" DECIMAL(14,2),
    "dda" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchSuggestion" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "triageBucket" "TriageBucket" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "confirmedAt" TIMESTAMP(3),
    "reason" "SuggestionReason" NOT NULL,
    "scorePercent" INTEGER NOT NULL,
    "amountScore" INTEGER NOT NULL DEFAULT 0,
    "nameScore" INTEGER NOT NULL DEFAULT 0,
    "dateScore" INTEGER NOT NULL DEFAULT 0,
    "ambiguityPenalty" INTEGER NOT NULL DEFAULT 0,
    "amountDifference" DECIMAL(14,2),
    "confidenceLabel" TEXT,
    "explanation" TEXT,
    "reviewedById" TEXT,
    "paymentVinculoKind" "PaymentVinculoKind",
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionBankLink" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "bankRecordId" TEXT NOT NULL,

    CONSTRAINT "SuggestionBankLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionInternalLink" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "internalRecordId" TEXT NOT NULL,

    CONSTRAINT "SuggestionInternalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationGroup" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceSuggestionId" TEXT,
    "reconciliationType" "ReconciliationType" NOT NULL,
    "confirmedByUserId" TEXT,
    "finalScorePercent" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationBankLink" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "bankRecordId" TEXT NOT NULL,

    CONSTRAINT "ReconciliationBankLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationInternalLink" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "internalRecordId" TEXT NOT NULL,

    CONSTRAINT "ReconciliationInternalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMark" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "reconciliationId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'NOT_PAID',
    "paidAmount" DECIMAL(14,2),
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "receiptUrl" TEXT,
    "notes" TEXT,
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounterpartyAlias" (
    "id" TEXT NOT NULL,
    "sourceType" "SourceType",
    "rawName" TEXT NOT NULL,
    "normalizedName" TEXT,
    "canonicalName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CounterpartyAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PixVinculoName" (
    "id" TEXT NOT NULL,
    "kind" "PaymentVinculoKind" NOT NULL DEFAULT 'PIX',
    "normalizedName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "registroNome" TEXT,
    "userCode" TEXT,
    "pixChave" TEXT,
    "tedBanco" TEXT,
    "tedAgencia" TEXT,
    "tedConta" TEXT,
    "tedCnpj" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixVinculoName_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "User_cardNumber_unit_key" ON "User"("cardNumber", "unit");

-- CreateIndex
CREATE INDEX "ReconciliationRun_referenceStartDate_referenceEndDate_idx" ON "ReconciliationRun"("referenceStartDate", "referenceEndDate");

-- CreateIndex
CREATE INDEX "ReconciliationRun_status_idx" ON "ReconciliationRun"("status");

-- CreateIndex
CREATE INDEX "ReconciliationRun_unit_idx" ON "ReconciliationRun"("unit");

-- CreateIndex
CREATE INDEX "ReconciliationRun_createdById_unit_idx" ON "ReconciliationRun"("createdById", "unit");

-- CreateIndex
CREATE INDEX "FileUpload_runId_idx" ON "FileUpload"("runId");

-- CreateIndex
CREATE INDEX "FileUpload_uploadedById_idx" ON "FileUpload"("uploadedById");

-- CreateIndex
CREATE INDEX "FileUpload_sourceType_status_idx" ON "FileUpload"("sourceType", "status");

-- CreateIndex
CREATE INDEX "FileUpload_fileHash_idx" ON "FileUpload"("fileHash");

-- CreateIndex
CREATE INDEX "FileUpload_createdAt_idx" ON "FileUpload"("createdAt");

-- CreateIndex
CREATE INDEX "BankRecord_runId_dueDate_idx" ON "BankRecord"("runId", "dueDate");

-- CreateIndex
CREATE INDEX "BankRecord_amount_idx" ON "BankRecord"("amount");

-- CreateIndex
CREATE INDEX "BankRecord_beneficiaryNameNorm_idx" ON "BankRecord"("beneficiaryNameNorm");

-- CreateIndex
CREATE INDEX "BankRecord_beneficiaryNameCanon_idx" ON "BankRecord"("beneficiaryNameCanon");

-- CreateIndex
CREATE INDEX "BankRecord_nossoNumero_idx" ON "BankRecord"("nossoNumero");

-- CreateIndex
CREATE INDEX "InternalRecord_runId_dueDate_idx" ON "InternalRecord"("runId", "dueDate");

-- CreateIndex
CREATE INDEX "InternalRecord_amount_idx" ON "InternalRecord"("amount");

-- CreateIndex
CREATE INDEX "InternalRecord_supplierNameNorm_idx" ON "InternalRecord"("supplierNameNorm");

-- CreateIndex
CREATE INDEX "InternalRecord_supplierNameCanon_idx" ON "InternalRecord"("supplierNameCanon");

-- CreateIndex
CREATE INDEX "InternalRecord_supplierCode_idx" ON "InternalRecord"("supplierCode");

-- CreateIndex
CREATE INDEX "InternalRecord_walletCode_idx" ON "InternalRecord"("walletCode");

-- CreateIndex
CREATE INDEX "InternalRecord_invoiceNumber_idx" ON "InternalRecord"("invoiceNumber");

-- CreateIndex
CREATE INDEX "MatchSuggestion_runId_triageBucket_idx" ON "MatchSuggestion"("runId", "triageBucket");

-- CreateIndex
CREATE INDEX "MatchSuggestion_runId_status_idx" ON "MatchSuggestion"("runId", "status");

-- CreateIndex
CREATE INDEX "MatchSuggestion_status_idx" ON "MatchSuggestion"("status");

-- CreateIndex
CREATE INDEX "MatchSuggestion_scorePercent_idx" ON "MatchSuggestion"("scorePercent");

-- CreateIndex
CREATE INDEX "MatchSuggestion_reason_idx" ON "MatchSuggestion"("reason");

-- CreateIndex
CREATE INDEX "MatchSuggestion_runId_confirmedAt_idx" ON "MatchSuggestion"("runId", "confirmedAt");

-- CreateIndex
CREATE INDEX "MatchSuggestion_paidAt_idx" ON "MatchSuggestion"("paidAt");

-- CreateIndex
CREATE INDEX "MatchSuggestion_runId_paidAt_idx" ON "MatchSuggestion"("runId", "paidAt");

-- CreateIndex
CREATE INDEX "SuggestionBankLink_bankRecordId_idx" ON "SuggestionBankLink"("bankRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionBankLink_suggestionId_bankRecordId_key" ON "SuggestionBankLink"("suggestionId", "bankRecordId");

-- CreateIndex
CREATE INDEX "SuggestionInternalLink_internalRecordId_idx" ON "SuggestionInternalLink"("internalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionInternalLink_suggestionId_internalRecordId_key" ON "SuggestionInternalLink"("suggestionId", "internalRecordId");

-- CreateIndex
CREATE INDEX "ReconciliationGroup_runId_idx" ON "ReconciliationGroup"("runId");

-- CreateIndex
CREATE INDEX "ReconciliationGroup_reconciliationType_idx" ON "ReconciliationGroup"("reconciliationType");

-- CreateIndex
CREATE INDEX "ReconciliationBankLink_bankRecordId_idx" ON "ReconciliationBankLink"("bankRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationBankLink_reconciliationId_bankRecordId_key" ON "ReconciliationBankLink"("reconciliationId", "bankRecordId");

-- CreateIndex
CREATE INDEX "ReconciliationInternalLink_internalRecordId_idx" ON "ReconciliationInternalLink"("internalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationInternalLink_reconciliationId_internalRecordI_key" ON "ReconciliationInternalLink"("reconciliationId", "internalRecordId");

-- CreateIndex
CREATE INDEX "PaymentMark_runId_status_idx" ON "PaymentMark"("runId", "status");

-- CreateIndex
CREATE INDEX "PaymentMark_paidAt_idx" ON "PaymentMark"("paidAt");

-- CreateIndex
CREATE INDEX "CounterpartyAlias_normalizedName_idx" ON "CounterpartyAlias"("normalizedName");

-- CreateIndex
CREATE INDEX "CounterpartyAlias_canonicalName_idx" ON "CounterpartyAlias"("canonicalName");

-- CreateIndex
CREATE UNIQUE INDEX "PixVinculoName_normalizedName_kind_key" ON "PixVinculoName"("normalizedName", "kind");

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileUpload" ADD CONSTRAINT "FileUpload_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileUpload" ADD CONSTRAINT "FileUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankRecord" ADD CONSTRAINT "BankRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankRecord" ADD CONSTRAINT "BankRecord_fileUploadId_fkey" FOREIGN KEY ("fileUploadId") REFERENCES "FileUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRecord" ADD CONSTRAINT "InternalRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRecord" ADD CONSTRAINT "InternalRecord_fileUploadId_fkey" FOREIGN KEY ("fileUploadId") REFERENCES "FileUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSuggestion" ADD CONSTRAINT "MatchSuggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSuggestion" ADD CONSTRAINT "MatchSuggestion_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSuggestion" ADD CONSTRAINT "MatchSuggestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionBankLink" ADD CONSTRAINT "SuggestionBankLink_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "MatchSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionBankLink" ADD CONSTRAINT "SuggestionBankLink_bankRecordId_fkey" FOREIGN KEY ("bankRecordId") REFERENCES "BankRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionInternalLink" ADD CONSTRAINT "SuggestionInternalLink_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "MatchSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionInternalLink" ADD CONSTRAINT "SuggestionInternalLink_internalRecordId_fkey" FOREIGN KEY ("internalRecordId") REFERENCES "InternalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationGroup" ADD CONSTRAINT "ReconciliationGroup_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationGroup" ADD CONSTRAINT "ReconciliationGroup_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationGroup" ADD CONSTRAINT "ReconciliationGroup_sourceSuggestionId_fkey" FOREIGN KEY ("sourceSuggestionId") REFERENCES "MatchSuggestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationBankLink" ADD CONSTRAINT "ReconciliationBankLink_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "ReconciliationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationBankLink" ADD CONSTRAINT "ReconciliationBankLink_bankRecordId_fkey" FOREIGN KEY ("bankRecordId") REFERENCES "BankRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationInternalLink" ADD CONSTRAINT "ReconciliationInternalLink_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "ReconciliationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationInternalLink" ADD CONSTRAINT "ReconciliationInternalLink_internalRecordId_fkey" FOREIGN KEY ("internalRecordId") REFERENCES "InternalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMark" ADD CONSTRAINT "PaymentMark_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMark" ADD CONSTRAINT "PaymentMark_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMark" ADD CONSTRAINT "PaymentMark_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "ReconciliationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixVinculoName" ADD CONSTRAINT "PixVinculoName_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
