import type { FastifyInstance } from 'fastify';
import { UserRole } from '../../generated/prisma/enums.js';
import { authMiddleware } from '../../middleware/auth-middleware.js';
import { roleMiddleware } from '../../middleware/auth-role-middleware.js';
import {
  getPaymentVinculoById,
  getPaymentVinculoInstruction,
  listPaymentVinculoNames,
  putPaymentVinculoById,
} from '../controllers/pix-vinculo-controller.js';
import {
  cancelStagedFileUpload,
  confirmStagedFileUpload,
  createReconciliationRun,
  finalizeReconciliationRun,
  getFileUploadStatus,
  getLatestReconciliationRun,
  getReconciliationRun,
  listRecentUploads,
  removeImportData,
  uploadBankFile,
  uploadInternalFile,
} from '../controllers/reconciliation-import-controller.js';
import {
  confirmSuggestion,
  confirmSuggestionsBatch,
  getSuggestionMultipleCandidates,
  listRunSuggestions,
  markSuggestionPaid,
  resolveMultipleCandidateAndConfirm,
  linkPaymentVinculo,
} from '../controllers/reconciliation-suggestions-controller.js';

const requireFinancial = [
  authMiddleware,
  roleMiddleware([UserRole.FINANCIAL, UserRole.ADMIN]),
];

export async function reconciliationRoutes(app: FastifyInstance) {
  app.get(
    '/payment-vinculo-names',
    { preHandler: requireFinancial },
    listPaymentVinculoNames,
  );
  app.get(
    '/payment-vinculo-names/:id',
    { preHandler: requireFinancial },
    getPaymentVinculoById,
  );
  app.put(
    '/payment-vinculo-names/:id',
    { preHandler: requireFinancial },
    putPaymentVinculoById,
  );
  app.post('/runs', { preHandler: requireFinancial }, createReconciliationRun);
  app.get(
    '/runs/latest',
    { preHandler: requireFinancial },
    getLatestReconciliationRun,
  );
  app.get(
    '/runs/:runId',
    { preHandler: requireFinancial },
    getReconciliationRun,
  );
  app.post(
    '/runs/:runId/finalize',
    { preHandler: requireFinancial },
    finalizeReconciliationRun,
  );
  app.get(
    '/runs/:runId/suggestions',
    { preHandler: requireFinancial },
    listRunSuggestions,
  );
  app.post(
    '/runs/:runId/suggestions/confirm-batch',
    { preHandler: requireFinancial },
    confirmSuggestionsBatch,
  );
  app.post(
    '/runs/:runId/suggestions/:suggestionId/confirm',
    { preHandler: requireFinancial },
    confirmSuggestion,
  );
  app.get(
    '/runs/:runId/suggestions/:suggestionId/payment-instruction',
    { preHandler: requireFinancial },
    getPaymentVinculoInstruction,
  );
  app.get(
    '/runs/:runId/suggestions/:suggestionId/candidates',
    { preHandler: requireFinancial },
    getSuggestionMultipleCandidates,
  );
  app.post(
    '/runs/:runId/suggestions/:suggestionId/resolve-candidate',
    { preHandler: requireFinancial },
    resolveMultipleCandidateAndConfirm,
  );
  app.post(
    '/runs/:runId/suggestions/:suggestionId/link-payment',
    { preHandler: requireFinancial },
    linkPaymentVinculo,
  );
  app.post(
    '/runs/:runId/suggestions/:suggestionId/mark-paid',
    { preHandler: requireFinancial },
    markSuggestionPaid,
  );
  app.post(
    '/runs/:runId/uploads/bank',
    { preHandler: requireFinancial },
    uploadBankFile,
  );
  app.post(
    '/runs/:runId/uploads/internal',
    { preHandler: requireFinancial },
    uploadInternalFile,
  );
  app.get(
    '/uploads',
    { preHandler: requireFinancial },
    listRecentUploads,
  );
  app.get(
    '/uploads/:fileUploadId',
    { preHandler: requireFinancial },
    getFileUploadStatus,
  );
  app.post(
    '/uploads/:fileUploadId/confirm',
    { preHandler: requireFinancial },
    confirmStagedFileUpload,
  );
  app.post(
    '/uploads/:fileUploadId/cancel',
    { preHandler: requireFinancial },
    cancelStagedFileUpload,
  );
  app.delete(
    '/uploads/:fileUploadId/records',
    { preHandler: requireFinancial },
    removeImportData,
  );
}
