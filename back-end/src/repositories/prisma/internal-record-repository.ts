import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { internalImportIdentityKey } from '../../lib/import-identity-key.js';

const CHUNK = 400;

export type InternalRecordIdentityRow = {
  id: string;
  importIdentityKey: string | null;
  supplierNameRaw: string;
  supplierNameNorm: string | null;
  supplierCode: number | null;
  invoiceNumber: string | null;
  walletCode: string | null;
  branchCode: string | null;
  installment: string | null;
  amount: Prisma.Decimal;
  amountPaid: Prisma.Decimal | null;
  dueDate: Date | null;
  issueDate: Date | null;
  dda: string | null;
  notes: string | null;
  rowNumber: number | null;
};

export function resolveInternalIdentityKey(row: InternalRecordIdentityRow): string {
  return (
    row.importIdentityKey ??
    internalImportIdentityKey({
      supplierCode: row.supplierCode,
      invoiceNumber: row.invoiceNumber,
      supplierNameNorm: row.supplierNameNorm,
      amount: row.amount,
      dueDate: row.dueDate,
    })
  );
}

export function internalRecordFieldsChanged(
  existing: InternalRecordIdentityRow,
  incoming: Prisma.InternalRecordCreateManyInput,
): boolean {
  const sameStr = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? '') === (b ?? '');
  const sameDate = (a: Date | null | undefined, b: unknown) => {
    const bDate = b instanceof Date ? b : b == null ? null : null;
    return (a?.getTime() ?? null) === (bDate?.getTime() ?? null);
  };
  const sameAmount = (
    a: Prisma.Decimal | null,
    b: unknown,
  ) => {
    if (a == null && (b == null || b === undefined)) return true;
    if (a == null || b == null || b === undefined) return false;
    return Number(a).toFixed(2) === Number(b).toFixed(2);
  };

  return (
    !sameStr(existing.supplierNameRaw, incoming.supplierNameRaw) ||
    !sameStr(existing.supplierNameNorm, incoming.supplierNameNorm) ||
    (existing.supplierCode ?? null) !== (incoming.supplierCode ?? null) ||
    !sameStr(existing.invoiceNumber, incoming.invoiceNumber) ||
    !sameStr(existing.walletCode, incoming.walletCode) ||
    !sameStr(existing.branchCode, incoming.branchCode) ||
    !sameStr(existing.installment, incoming.installment) ||
    !sameAmount(existing.amount, incoming.amount) ||
    !sameAmount(existing.amountPaid, incoming.amountPaid) ||
    !sameDate(existing.dueDate, incoming.dueDate) ||
    !sameDate(existing.issueDate, incoming.issueDate) ||
    !sameStr(existing.dda, incoming.dda) ||
    !sameStr(existing.notes, incoming.notes) ||
    (existing.rowNumber ?? null) !== (incoming.rowNumber ?? null)
  );
}

export class InternalRecordPrismaRepository {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  async deleteManyByRunId(runId: string) {
    return this.prisma.internalRecord.deleteMany({
      where: { runId },
    });
  }

  async deleteManyByFileUploadId(fileUploadId: string) {
    return this.prisma.internalRecord.deleteMany({
      where: { fileUploadId },
    });
  }

  async countByRunId(runId: string) {
    return this.prisma.internalRecord.count({ where: { runId } });
  }

  /** Lançamentos do interno (Epron) de uma conciliação, paginados (para visualização). */
  async listByRunId(runId: string, opts: { skip: number; take: number }) {
    return this.prisma.internalRecord.findMany({
      where: { runId },
      orderBy: [{ dueDate: 'asc' }, { rowNumber: 'asc' }],
      skip: opts.skip,
      take: opts.take,
      select: {
        id: true,
        rowNumber: true,
        dueDate: true,
        issueDate: true,
        supplierNameRaw: true,
        invoiceNumber: true,
        installment: true,
        amount: true,
        amountPaid: true,
      },
    });
  }

  async findIdentityRowsByRunId(
    runId: string,
  ): Promise<InternalRecordIdentityRow[]> {
    return this.prisma.internalRecord.findMany({
      where: { runId },
      select: {
        id: true,
        importIdentityKey: true,
        supplierNameRaw: true,
        supplierNameNorm: true,
        supplierCode: true,
        invoiceNumber: true,
        walletCode: true,
        branchCode: true,
        installment: true,
        amount: true,
        amountPaid: true,
        dueDate: true,
        issueDate: true,
        dda: true,
        notes: true,
        rowNumber: true,
      },
    });
  }

  async createManyChunked(records: Prisma.InternalRecordCreateManyInput[]) {
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      await this.prisma.internalRecord.createMany({ data: chunk });
    }
  }

  async updateManyById(
    updates: { id: string; data: Prisma.InternalRecordUpdateInput }[],
  ) {
    for (const u of updates) {
      await this.prisma.internalRecord.update({
        where: { id: u.id },
        data: u.data,
      });
    }
  }
}
