import type { Prisma } from '../generated/prisma/client.js';
import {
  bankRecordFieldsChanged,
  BankRecordPrismaRepository,
  resolveBankIdentityKey,
} from '../repositories/prisma/bank-record-repository.js';
import {
  internalRecordFieldsChanged,
  InternalRecordPrismaRepository,
  resolveInternalIdentityKey,
} from '../repositories/prisma/internal-record-repository.js';

export type BankImportDedupPlan = {
  inserted: number;
  updated: number;
  skipped: number;
  toInsert: Prisma.BankRecordCreateManyInput[];
  updates: { id: string; data: Prisma.BankRecordUpdateInput }[];
};

export type InternalImportDedupPlan = {
  inserted: number;
  updated: number;
  skipped: number;
  toInsert: Prisma.InternalRecordCreateManyInput[];
  updates: { id: string; data: Prisma.InternalRecordUpdateInput }[];
};

export async function planBankImportDedup(
  repo: BankRecordPrismaRepository,
  runId: string,
  candidates: Prisma.BankRecordCreateManyInput[],
): Promise<BankImportDedupPlan> {
  const existingRows = await repo.findIdentityRowsByRunId(runId);
  const existingByKey = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    existingByKey.set(resolveBankIdentityKey(row), row);
  }

  const toInsert: Prisma.BankRecordCreateManyInput[] = [];
  const updates: { id: string; data: Prisma.BankRecordUpdateInput }[] = [];
  let skipped = 0;

  for (const candidate of candidates) {
    const key = candidate.importIdentityKey;
    if (!key) continue;
    const existing = existingByKey.get(key);
    if (!existing) {
      toInsert.push(candidate);
      continue;
    }
    if (bankRecordFieldsChanged(existing, candidate)) {
      updates.push({
        id: existing.id,
        data: {
          rowNumber: candidate.rowNumber,
          dueDate: candidate.dueDate,
          beneficiaryNameRaw: candidate.beneficiaryNameRaw,
          beneficiaryNameNorm: candidate.beneficiaryNameNorm,
          payerNameRaw: candidate.payerNameRaw,
          nossoNumero: candidate.nossoNumero,
          amount: candidate.amount,
          importIdentityKey: key,
        },
      });
    } else {
      skipped++;
    }
  }

  return {
    inserted: toInsert.length,
    updated: updates.length,
    skipped,
    toInsert,
    updates,
  };
}

export async function planInternalImportDedup(
  repo: InternalRecordPrismaRepository,
  runId: string,
  candidates: Prisma.InternalRecordCreateManyInput[],
): Promise<InternalImportDedupPlan> {
  const existingRows = await repo.findIdentityRowsByRunId(runId);
  const existingByKey = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    existingByKey.set(resolveInternalIdentityKey(row), row);
  }

  const toInsert: Prisma.InternalRecordCreateManyInput[] = [];
  const updates: { id: string; data: Prisma.InternalRecordUpdateInput }[] =
    [];
  let skipped = 0;

  for (const candidate of candidates) {
    const key = candidate.importIdentityKey;
    if (!key) continue;
    const existing = existingByKey.get(key);
    if (!existing) {
      toInsert.push(candidate);
      continue;
    }
    if (internalRecordFieldsChanged(existing, candidate)) {
      updates.push({
        id: existing.id,
        data: {
          rowNumber: candidate.rowNumber,
          dueDate: candidate.dueDate,
          issueDate: candidate.issueDate,
          supplierCode: candidate.supplierCode,
          supplierNameRaw: candidate.supplierNameRaw,
          supplierNameNorm: candidate.supplierNameNorm,
          walletCode: candidate.walletCode,
          branchCode: candidate.branchCode,
          invoiceNumber: candidate.invoiceNumber,
          installment: candidate.installment,
          amount: candidate.amount,
          amountPaid: candidate.amountPaid,
          dda: candidate.dda,
          notes: candidate.notes,
          importIdentityKey: key,
        },
      });
    } else {
      skipped++;
    }
  }

  return {
    inserted: toInsert.length,
    updated: updates.length,
    skipped,
    toInsert,
    updates,
  };
}

export async function commitBankImportDedup(
  repo: BankRecordPrismaRepository,
  fileUploadId: string,
  plan: BankImportDedupPlan,
) {
  await repo.deleteManyByFileUploadId(fileUploadId);
  if (plan.toInsert.length) {
    await repo.createManyChunked(plan.toInsert);
  }
  if (plan.updates.length) {
    await repo.updateManyById(plan.updates);
  }
}

export async function commitInternalImportDedup(
  repo: InternalRecordPrismaRepository,
  fileUploadId: string,
  plan: InternalImportDedupPlan,
) {
  await repo.deleteManyByFileUploadId(fileUploadId);
  if (plan.toInsert.length) {
    await repo.createManyChunked(plan.toInsert);
  }
  if (plan.updates.length) {
    await repo.updateManyById(plan.updates);
  }
}
