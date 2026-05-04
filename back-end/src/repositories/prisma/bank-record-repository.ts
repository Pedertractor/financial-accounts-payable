import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

const CHUNK = 400;

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

  async createManyChunked(records: Prisma.BankRecordCreateManyInput[]) {
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      await this.prisma.bankRecord.createMany({ data: chunk });
    }
  }
}
