-- AlterEnum
ALTER TYPE "PaymentVinculoKind" ADD VALUE 'BOLETO';

-- AlterEnum
ALTER TYPE "SuggestionReason" ADD VALUE 'BOLETO_VINCULO_OK';

-- AlterTable
ALTER TABLE "MatchSuggestion" ADD COLUMN     "manualBoletoEvidenceRelPath" TEXT;
