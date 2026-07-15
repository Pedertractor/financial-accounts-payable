import { RunStatus, SuggestionStatus } from '../generated/prisma/enums.js';
import type { UnitType } from '../generated/prisma/enums.js';
import { HttpError } from '../http/erros/index.js';
import { prisma } from '../lib/prisma.js';
import { BankRecordPrismaRepository } from '../repositories/prisma/bank-record-repository.js';
import { InternalRecordPrismaRepository } from '../repositories/prisma/internal-record-repository.js';
import { ReconciliationRunPrismaRepository } from '../repositories/prisma/reconciliation-run-repository.js';

export const RUN_CLOSED_IMPORT_MESSAGE =
  'Esta conciliação foi encerrada. Inicie uma nova conciliação para importar planilhas.';

const RECORDS_MAX_PAGE_SIZE = 200;
const RECORDS_DEFAULT_PAGE_SIZE = 50;

export type RunRecordType = 'bank' | 'internal';

export class ReconciliationRunService {
  private readonly runRepo = new ReconciliationRunPrismaRepository(prisma);
  private readonly bankRepo = new BankRecordPrismaRepository(prisma);
  private readonly internalRepo = new InternalRecordPrismaRepository(prisma);

  async listRuns(unit: UnitType, status?: RunStatus) {
    const runs = await this.runRepo.listByUnit(unit, status);
    return runs.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      unit: r.unit,
      referenceStartDate: r.referenceStartDate?.toISOString() ?? null,
      referenceEndDate: r.referenceEndDate?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      counts: {
        bank: r._count.bankRecords,
        internal: r._count.internalRecords,
        suggestions: r._count.suggestions,
        uploads: r._count.uploads,
      },
    }));
  }

  async listRunRecords(
    runId: string,
    type: RunRecordType,
    page: number,
    pageSize: number,
  ) {
    await this.getRunOrThrow(runId);
    const safePageSize = Math.min(
      Math.max(1, pageSize || RECORDS_DEFAULT_PAGE_SIZE),
      RECORDS_MAX_PAGE_SIZE,
    );
    const safePage = Math.max(1, page || 1);
    const skip = (safePage - 1) * safePageSize;

    if (type === 'bank') {
      const [total, rows] = await Promise.all([
        this.bankRepo.countByRunId(runId),
        this.bankRepo.listByRunId(runId, { skip, take: safePageSize }),
      ]);
      return {
        type,
        page: safePage,
        pageSize: safePageSize,
        total,
        records: rows.map((r) => ({
          id: r.id,
          rowNumber: r.rowNumber,
          dueDate: r.dueDate?.toISOString() ?? null,
          beneficiaryNameRaw: r.beneficiaryNameRaw,
          payerNameRaw: r.payerNameRaw,
          nossoNumero: r.nossoNumero,
          amount: r.amount.toString(),
        })),
      };
    }

    const [total, rows] = await Promise.all([
      this.internalRepo.countByRunId(runId),
      this.internalRepo.listByRunId(runId, { skip, take: safePageSize }),
    ]);
    return {
      type,
      page: safePage,
      pageSize: safePageSize,
      total,
      records: rows.map((r) => ({
        id: r.id,
        rowNumber: r.rowNumber,
        dueDate: r.dueDate?.toISOString() ?? null,
        issueDate: r.issueDate?.toISOString() ?? null,
        supplierNameRaw: r.supplierNameRaw,
        invoiceNumber: r.invoiceNumber,
        installment: r.installment,
        amount: r.amount.toString(),
        amountPaid: r.amountPaid?.toString() ?? null,
      })),
    };
  }

  async getRunOrThrow(runId: string) {
    const run = await this.runRepo.findById(runId);
    if (!run) {
      throw new HttpError('Execução de conciliação não encontrada', 404);
    }
    return run;
  }

  assertRunOpen(run: { status: RunStatus }) {
    if (run.status === RunStatus.CLOSED) {
      throw new HttpError(RUN_CLOSED_IMPORT_MESSAGE, 400);
    }
  }

  async assertRunOpenForImport(runId: string) {
    const run = await this.getRunOrThrow(runId);
    this.assertRunOpen(run);
    return run;
  }

  async getClosePreview(runId: string) {
    await this.getRunOrThrow(runId);
    const [openSuggestionsCount, bankRecordCount, internalRecordCount] =
      await Promise.all([
        prisma.matchSuggestion.count({
          where: { runId, status: SuggestionStatus.OPEN },
        }),
        prisma.bankRecord.count({ where: { runId } }),
        prisma.internalRecord.count({ where: { runId } }),
      ]);
    const warnings: string[] = [];
    if (openSuggestionsCount > 0) {
      warnings.push(
        `Há ${openSuggestionsCount} sugestões ainda em aberto na triagem.`,
      );
    }
    if (bankRecordCount > 0 && internalRecordCount === 0) {
      warnings.push(
        'Há lançamentos só do banco; o interno ainda não foi importado neste ciclo.',
      );
    }
    if (internalRecordCount > 0 && bankRecordCount === 0) {
      warnings.push(
        'Há lançamentos só do interno; o banco ainda não foi importado neste ciclo.',
      );
    }
    return {
      openSuggestionsCount,
      bankRecordCount,
      internalRecordCount,
      warnings,
    };
  }

  /**
   * Exclui uma conciliação VAZIA (sem lançamentos importados). Para limpar ciclos de teste/engano.
   * Conciliações com dados não podem ser excluídas — use `closeRun` (arquivar).
   */
  async deleteEmptyRun(runId: string) {
    await this.getRunOrThrow(runId);
    const [bank, internal] = await Promise.all([
      this.bankRepo.countByRunId(runId),
      this.internalRepo.countByRunId(runId),
    ]);
    if (bank > 0 || internal > 0) {
      throw new HttpError(
        'Só é possível excluir conciliações vazias (sem lançamentos importados). Use Encerrar para arquivar uma conciliação com dados.',
        400,
      );
    }
    await prisma.$transaction(async (tx) => {
      // FileUpload.run é SetNull; removemos aqui para não deixar uploads órfãos ao excluir o run.
      await tx.fileUpload.deleteMany({ where: { runId } });
      await tx.reconciliationRun.delete({ where: { id: runId } });
    });
  }

  async closeRun(runId: string) {
    const run = await this.getRunOrThrow(runId);
    if (run.status === RunStatus.CLOSED) {
      throw new HttpError('Esta conciliação já está encerrada.', 400);
    }
    const summary = await this.getClosePreview(runId);
    const updated = await this.runRepo.updateById(runId, {
      status: RunStatus.CLOSED,
    });
    return { run: updated, summary };
  }

  async reopenRun(runId: string) {
    const run = await this.getRunOrThrow(runId);
    if (run.status !== RunStatus.CLOSED) {
      throw new HttpError('Só conciliações encerradas podem ser reabertas.', 400);
    }
    const updated = await this.runRepo.updateById(runId, {
      status: RunStatus.OPEN,
    });
    return { run: updated };
  }
}
