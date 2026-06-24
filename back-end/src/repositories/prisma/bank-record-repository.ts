import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { bankImportIdentityKey } from '../../lib/import-identity-key.js';

const CHUNK = 400;

export type BankRecordIdentityRow = {
  id: string;
  importIdentityKey: string | null;
  beneficiaryNameRaw: string;
  beneficiaryNameNorm: string | null;
  payerNameRaw: string | null;
  nossoNumero: string | null;
  amount: Prisma.Decimal;
  dueDate: Date | null;
  rowNumber: number | null;
};

export function resolveBankIdentityKey(row: BankRecordIdentityRow): string {
  return (
    row.importIdentityKey ??
    bankImportIdentityKey({
      nossoNumero: row.nossoNumero,
      beneficiaryNameNorm: row.beneficiaryNameNorm,
      amount: row.amount,
      dueDate: row.dueDate,
    })
  );
}

export function bankRecordFieldsChanged(
  existing: BankRecordIdentityRow,
  incoming: Prisma.BankRecordCreateManyInput,
): boolean {
  const sameStr = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? '') === (b ?? '');
  const sameDate = (a: Date | null | undefined, b: unknown) => {
    const bDate = b instanceof Date ? b : b == null ? null : null;
    return (a?.getTime() ?? null) === (bDate?.getTime() ?? null);
  };
  const sameAmount = (a: Prisma.Decimal, b: unknown) =>
    Number(a).toFixed(2) === Number(b).toFixed(2);

  return (
    !sameStr(existing.beneficiaryNameRaw, incoming.beneficiaryNameRaw) ||
    !sameStr(existing.beneficiaryNameNorm, incoming.beneficiaryNameNorm) ||
    !sameStr(existing.payerNameRaw, incoming.payerNameRaw) ||
    !sameStr(existing.nossoNumero, incoming.nossoNumero) ||
    !sameAmount(existing.amount, incoming.amount) ||
    !sameDate(existing.dueDate, incoming.dueDate) ||
    (existing.rowNumber ?? null) !== (incoming.rowNumber ?? null)
  );
}

export class BankRecordPrismaRepository {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  async deleteManyByRunId(runId: string) {
    return this.prisma.bankRecord.deleteMany({
      where: { runId },
    });
  }

  async deleteManyByFileUploadId(fileUploadId: string) {
    return this.prisma.bankRecord.deleteMany({
      where: { fileUploadId },
    });
  }

  async findIdentityRowsByRunId(runId: string): Promise<BankRecordIdentityRow[]> {
    return this.prisma.bankRecord.findMany({
      where: { runId },
      select: {
        id: true,
        importIdentityKey: true,
        beneficiaryNameRaw: true,
        beneficiaryNameNorm: true,
        payerNameRaw: true,
        nossoNumero: true,
        amount: true,
        dueDate: true,
        rowNumber: true,
      },
    });
  }

  async createManyChunked(records: Prisma.BankRecordCreateManyInput[]) {
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      await this.prisma.bankRecord.createMany({ data: chunk });
    }
  }

  async updateManyById(
    updates: { id: string; data: Prisma.BankRecordUpdateInput }[],
  ) {
    for (const u of updates) {
      await this.prisma.bankRecord.update({
        where: { id: u.id },
        data: u.data,
      });
    }
  }
}
