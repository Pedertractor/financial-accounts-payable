import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { RunStatus, UnitType } from '../../generated/prisma/enums.js';

export class ReconciliationRunPrismaRepository {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  async findById(id: string) {
    return this.prisma.reconciliationRun.findUnique({
      where: { id },
    });
  }

  /** Lista as conciliações da empresa (mais recentes primeiro) com contagens de lançamentos e sugestões. */
  async listByUnit(unit: UnitType, status?: RunStatus) {
    return this.prisma.reconciliationRun.findMany({
      where: { unit, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            bankRecords: true,
            internalRecords: true,
            suggestions: true,
            uploads: true,
          },
        },
      },
    });
  }

  async create(data: Prisma.ReconciliationRunCreateInput) {
    return this.prisma.reconciliationRun.create({ data });
  }

  async updateById(id: string, data: Prisma.ReconciliationRunUpdateInput) {
    return this.prisma.reconciliationRun.update({
      where: { id },
      data,
    });
  }
}
