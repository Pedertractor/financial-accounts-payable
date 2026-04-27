import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

const CHUNK = 400;

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

  async createManyChunked(records: Prisma.InternalRecordCreateManyInput[]) {
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      await this.prisma.internalRecord.createMany({ data: chunk });
    }
  }
}
