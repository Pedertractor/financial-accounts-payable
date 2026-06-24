import { RunStatus, SuggestionStatus } from '../generated/prisma/enums.js';
import { HttpError } from '../http/erros/index.js';
import { prisma } from '../lib/prisma.js';
import { ReconciliationRunPrismaRepository } from '../repositories/prisma/reconciliation-run-repository.js';

export const RUN_CLOSED_IMPORT_MESSAGE =
  'Esta conciliação foi encerrada. Inicie uma nova conciliação para importar planilhas.';

export class ReconciliationRunService {
  private readonly runRepo = new ReconciliationRunPrismaRepository(prisma);

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
