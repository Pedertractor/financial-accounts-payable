import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export class ReconciliationRunPrismaRepository {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  async findById(id: string) {
    return this.prisma.reconciliationRun.findUnique({
      where: { id },
    });
  }

  async create(data: Prisma.ReconciliationRunCreateInput) {
    return this.prisma.reconciliationRun.create({ data });
  }
}
