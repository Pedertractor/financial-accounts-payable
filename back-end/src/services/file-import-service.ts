import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import * as XLSX from 'xlsx';
import { Prisma } from '../generated/prisma/client.js';
import { RunStatus, SourceType, UploadStatus, UnitType } from '../generated/prisma/enums.js';
import { env } from '../env/index.js';
import { HttpError } from '../http/erros/index.js';
import {
  BANK_COLUMN_SYNONYMS,
  type BankImportField,
  detectHeaderRowAndColumns,
  INTERNAL_COLUMN_SYNONYMS,
  type InternalImportField,
  preferInternalSupplierNameColumn,
} from '../lib/excel/column-maps.js';
import { generateMatchSuggestionsForRun } from './reconciliation-matcher.js';
import {
  isRowEmpty,
  parseBrAmount,
  parseFlexibleDate,
} from '../lib/excel/spreadsheet-helpers.js';
import { normalizeCounterpartyName } from '../lib/name-normalize.js';
import {
  bankImportIdentityKey,
  internalImportIdentityKey,
} from '../lib/import-identity-key.js';
import { prisma } from '../lib/prisma.js';
import { BankRecordPrismaRepository } from '../repositories/prisma/bank-record-repository.js';
import { FileUploadPrismaRepository } from '../repositories/prisma/file-upload-repository.js';
import { InternalRecordPrismaRepository } from '../repositories/prisma/internal-record-repository.js';
import { ReconciliationRunPrismaRepository } from '../repositories/prisma/reconciliation-run-repository.js';
import { ReconciliationRunService } from './reconciliation-run-service.js';
import {
  commitBankImportDedup,
  commitInternalImportDedup,
  planBankImportDedup,
  planInternalImportDedup,
} from './import-record-dedup.js';

const PARSER_VERSION = 'excel-mvp-1';
const MAX_SHEET_ROWS = 100_000;
const PROGRESS_EVERY = 200;

/**
 * Buffer da planilha só em memória até confirmar/descartar/concluir.
 * Não grava o arquivo em disco — só os dados importados no Postgres.
 */
const pendingUploadBuffers = new Map<string, Buffer>();

function rememberUploadBuffer(fileUploadId: string, buffer: Buffer) {
  pendingUploadBuffers.set(fileUploadId, buffer);
}

function takeUploadBuffer(fileUploadId: string): Buffer | undefined {
  return pendingUploadBuffers.get(fileUploadId);
}

function releaseUploadBuffer(fileUploadId: string) {
  pendingUploadBuffers.delete(fileUploadId);
}

/** Logs de diagnóstico (importação em duas etapas + finalize). */
const reconciliationImportLogPrefix = '[reconciliation-import]';

function getCell(row: unknown[], col: number | undefined): unknown {
  if (col === undefined) return null;
  return row[col] ?? null;
}

function toOptionalString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toOptionalInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  const s = String(v).replace(/\D/g, '');
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

type Matrix = unknown[][];

function sheetToMatrix(worksheet: XLSX.WorkSheet): Matrix {
  const m = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];
  if (!m.length) return [[]];
  if (m.length > MAX_SHEET_ROWS) {
    return m.slice(0, MAX_SHEET_ROWS);
  }
  return m;
}

export class FileImportService {
  private readonly runRepo = new ReconciliationRunPrismaRepository(prisma);
  private readonly uploadRepo = new FileUploadPrismaRepository(prisma);
  private readonly bankRepo = new BankRecordPrismaRepository(prisma);
  private readonly internalRepo = new InternalRecordPrismaRepository(prisma);

  async createRun(params: {
    userId: string;
    unit: UnitType;
    title?: string;
    referenceStartDate?: string | null;
    referenceEndDate?: string | null;
  }) {
    const { userId, unit, title, referenceStartDate, referenceEndDate } = params;
    return this.runRepo.create({
      unit,
      title: title?.trim() || 'Conciliação',
      referenceStartDate: referenceStartDate
        ? new Date(referenceStartDate)
        : null,
      referenceEndDate: referenceEndDate
        ? new Date(referenceEndDate)
        : null,
      status: 'OPEN',
      createdBy: { connect: { id: userId } },
    });
  }

  async getRunOrThrow(runId: string) {
    const run = await this.runRepo.findById(runId);
    if (!run) {
      throw new HttpError('Execução de conciliação não encontrada', 404);
    }
    return run;
  }

  async getUploadOrThrow(id: string) {
    const row = await this.uploadRepo.findById(id);
    if (!row) {
      throw new HttpError('Upload não encontrado', 404);
    }
    return row;
  }

  async listRecentFinishedUploads(limit: number) {
    const rows = await this.uploadRepo.listRecentFinished({ limit });
    return rows.map((u) => this.toUploadStatusDto(u));
  }

  toUploadStatusDto(
    u: Awaited<ReturnType<FileUploadPrismaRepository['findById']>>,
  ) {
    if (!u) throw new Error('expected upload');
    const done =
      u.status === UploadStatus.COMPLETED ||
      u.status === UploadStatus.PARTIAL_SUCCESS;
    const total = u.totalRowsDetected ?? 0;
    const read = u.totalRowsRead ?? 0;
    let progressPercent = 0;
    if (done) {
      progressPercent = 100;
    } else if (u.status === UploadStatus.FAILED) {
      progressPercent = 0;
    } else if (u.status === UploadStatus.CANCELLED) {
      progressPercent = 0;
    } else if (u.status === UploadStatus.AWAITING_CONFIRM) {
      progressPercent = 100;
    } else if (total > 0) {
      progressPercent = Math.min(99, Math.round((read / total) * 100));
    }
    const w = u.warningDetailsJson as
      | { samples?: { row: number; text: string }[] }
      | null
      | undefined;
    return {
      id: u.id,
      runId: u.runId,
      sourceType: u.sourceType,
      status: u.status,
      originalFileName: u.originalFileName,
      fileSizeBytes: u.fileSizeBytes,
      totalRowsDetected: u.totalRowsDetected,
      totalRowsRead: u.totalRowsRead,
      totalRowsImported: u.totalRowsImported,
      totalRowsRejected: u.totalRowsRejected,
      totalRowsSkipped: u.totalRowsSkipped,
      totalRowsUpdated: u.totalRowsUpdated,
      totalRowsWithWarnings: u.totalRowsWithWarnings,
      errorMessage: u.errorMessage,
      progressPercent,
      parsingStartedAt: u.parsingStartedAt,
      finishedAt: u.finishedAt,
      needsUserConfirmation: u.status === UploadStatus.AWAITING_CONFIRM,
      warningDetails: w?.samples
        ? { samples: w.samples }
        : null,
      isReimport: this.isReimportFromWarningDetails(u.warningDetailsJson),
    };
  }

  private isReimportFromWarningDetails(
    json: Prisma.JsonValue | null | undefined,
  ): boolean {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
    return (json as { isReimport?: boolean }).isReimport === true;
  }

  private async detectReimport(fileUploadId: string): Promise<boolean> {
    const upload = await this.uploadRepo.findById(fileUploadId);
    if (!upload?.fileHash || !upload.runId) return false;
    const prior = await this.uploadRepo.findCompletedByRunIdAndHash(
      upload.runId,
      upload.fileHash,
      fileUploadId,
    );
    return !!prior;
  }

  private dedupSummaryJson(params: {
    isReimport: boolean;
    samples?: { row: number; text: string }[];
  }) {
    if (params.samples?.length) {
      return { samples: params.samples, isReimport: params.isReimport };
    }
    if (params.isReimport) {
      return { isReimport: true };
    }
    return undefined;
  }

  async saveUploadAndQueueProcess(params: {
    runId: string;
    userId: string;
    sourceType: SourceType;
    buffer: Buffer;
    originalFileName: string;
    mimetype: string;
  }): Promise<{ fileUploadId: string }> {
    await new ReconciliationRunService().assertRunOpenForImport(params.runId);
    await this.getRunOrThrow(params.runId);
    const superseded = await prisma.fileUpload.findMany({
      where: {
        runId: params.runId,
        sourceType: params.sourceType,
        status: UploadStatus.AWAITING_CONFIRM,
      },
      select: { id: true },
    });
    await this.uploadRepo.cancelAwaitingStagedByRunIdAndSource(
      params.runId,
      params.sourceType,
    );
    for (const row of superseded) {
      releaseUploadBuffer(row.id);
    }
    if (params.buffer.length > env.MAX_UPLOAD_BYTES) {
      throw new HttpError(
        `Arquivo excede o tamanho máximo de ${env.MAX_UPLOAD_BYTES} bytes`,
        413,
      );
    }
    const ext = (extname(params.originalFileName) || '.xlsx').toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      throw new HttpError(
        'Formato inválido. Use planilha .xlsx, .xls ou .csv',
        400,
      );
    }
    const fileId = randomUUID();
    const stored = `${fileId}${ext}`;
    const fileHash = createHash('sha256').update(params.buffer).digest('hex');

    const fileUpload = await this.uploadRepo.create({
      run: { connect: { id: params.runId } },
      uploadedBy: { connect: { id: params.userId } },
      sourceType: params.sourceType,
      status: UploadStatus.RECEIVED,
      originalFileName: params.originalFileName,
      storedFileName: stored,
      storagePath: null,
      mimeType: params.mimetype,
      fileExtension: ext.replace(/^\./, '') || 'xlsx',
      fileSizeBytes: params.buffer.length,
      fileHash,
      startedAt: new Date(),
      parserVersion: PARSER_VERSION,
    });

    rememberUploadBuffer(fileUpload.id, params.buffer);
    void this.runProcessInBackground(fileUpload.id);
    return { fileUploadId: fileUpload.id };
  }

  private async runProcessInBackground(fileUploadId: string) {
    await setImmediate();
    try {
      await this.processFileUpload(fileUploadId);
    } catch (e) {
      console.error('processFileUpload', fileUploadId, e);
      const msg = e instanceof Error ? e.message : 'Erro ao importar';
      releaseUploadBuffer(fileUploadId);
      try {
        await this.uploadRepo.updateById(fileUploadId, {
          status: UploadStatus.FAILED,
          errorMessage: msg,
          finishedAt: new Date(),
        });
      } catch (err) {
        console.error('Falha ao marcar upload como FAILED', err);
      }
    }
  }

  private async processFileUpload(id: string) {
    const upload = await this.uploadRepo.findById(id);
    const buffer = takeUploadBuffer(id);
    if (!upload || !buffer) {
      throw new Error('Upload inválido ou buffer da planilha já foi liberado');
    }
    const t0 = Date.now();
    await this.uploadRepo.updateById(id, {
      status: UploadStatus.PARSING,
      parsingStartedAt: new Date(),
    });

    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      await this.fail(id, t0, 'A planilha não contém abas.');
      return;
    }
    const sheet = wb.Sheets[sheetName];
    const matrix = sheetToMatrix(sheet);
    const workbookSheetCount = wb.SheetNames.length;
    const selectedSheetName = sheetName;

    await this.uploadRepo.updateById(id, {
      workbookSheetCount: workbookSheetCount,
      selectedSheetName,
    });

    console.log(`${reconciliationImportLogPrefix} processFileUpload início`, {
      fileUploadId: id,
      runId: upload.runId,
      sourceType: upload.sourceType,
      primeiraAba: selectedSheetName,
      totalAbas: workbookSheetCount,
    });

    if (upload.sourceType === 'BANK') {
      await this.importBank(
        id,
        upload.runId!,
        matrix,
        t0,
      );
    } else {
      await this.importInternal(
        id,
        upload.runId!,
        matrix,
        t0,
      );
    }
  }

  private async fail(id: string, t0: number, message: string) {
    releaseUploadBuffer(id);
    await this.uploadRepo.updateById(id, {
      status: UploadStatus.FAILED,
      errorMessage: message,
      errorDetailsJson: { message },
      totalDurationMs: Date.now() - t0,
      finishedAt: new Date(),
    });
  }

  async confirmStagedImport(fileUploadId: string) {
    const upload = await this.getUploadOrThrow(fileUploadId);
    if (upload.runId) {
      await new ReconciliationRunService().assertRunOpenForImport(upload.runId);
    }
    if (upload.status !== UploadStatus.AWAITING_CONFIRM) {
      throw new HttpError('Nada para confirmar neste upload ou já foi processado.', 400);
    }
    const buffer = takeUploadBuffer(fileUploadId);
    if (!buffer || !upload.runId) {
      throw new HttpError(
        'Dados da planilha não estão mais disponíveis (servidor reiniciou ou o arquivo já foi liberado). Faça o upload de novo.',
        400,
      );
    }
    console.log(`${reconciliationImportLogPrefix} confirmStagedImport (commit no banco)`, {
      fileUploadId,
      runId: upload.runId,
      sourceType: upload.sourceType,
      originalFileName: upload.originalFileName,
    });
    const t0 = Date.now();
    try {
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
      const sheetName = upload.selectedSheetName || wb.SheetNames[0];
      if (!sheetName) {
        throw new HttpError('Planilha vazia ou corrompida', 400);
      }
      const sheet = wb.Sheets[sheetName];
      const matrix = sheetToMatrix(sheet);
      if (upload.sourceType === 'BANK') {
        await this.importBank(
          fileUploadId,
          upload.runId,
          matrix,
          t0,
          'commit',
        );
      } else {
        await this.importInternal(
          fileUploadId,
          upload.runId,
          matrix,
          t0,
          'commit',
        );
      }
    } finally {
      releaseUploadBuffer(fileUploadId);
    }
  }

  async cancelStagedImport(fileUploadId: string) {
    const u = await this.getUploadOrThrow(fileUploadId);
    if (u.status !== UploadStatus.AWAITING_CONFIRM) {
      throw new HttpError(
        'Apenas importações aguardando confirmação podem ser descartadas desta forma.',
        400,
      );
    }
    releaseUploadBuffer(fileUploadId);
    await this.uploadRepo.updateById(fileUploadId, {
      status: UploadStatus.CANCELLED,
      errorMessage:
        'Importação descartada. Nenhum dado deste arquivo foi salvo no banco de conciliação.',
    });
    console.log(`${reconciliationImportLogPrefix} cancelStagedImport`, {
      fileUploadId,
      runId: u.runId,
      sourceType: u.sourceType,
    });
  }

  /**
   * Remove do banco os lançamentos deste upload e marca o arquivo como cancelado.
   * Se ainda estiver aguardando confirmação, equivale a descartar a importação (sem registros a apagar).
   */
  async removeImportDataForUpload(fileUploadId: string) {
    const u = await this.getUploadOrThrow(fileUploadId);
    if (u.status === UploadStatus.AWAITING_CONFIRM) {
      await this.cancelStagedImport(fileUploadId);
      return;
    }
    if (
      u.status !== UploadStatus.COMPLETED &&
      u.status !== UploadStatus.PARTIAL_SUCCESS
    ) {
      throw new HttpError(
        'Nada para remover: a importação ainda está em andamento, falhou ou já foi removida.',
        400,
      );
    }
    await prisma.$transaction(async (tx) => {
      if (u.sourceType === 'BANK') {
        const repo = new BankRecordPrismaRepository(tx);
        await repo.deleteManyByFileUploadId(fileUploadId);
      } else {
        const repo = new InternalRecordPrismaRepository(tx);
        await repo.deleteManyByFileUploadId(fileUploadId);
      }
      const upload = new FileUploadPrismaRepository(tx);
      await upload.updateById(fileUploadId, {
        status: UploadStatus.CANCELLED,
        errorMessage: 'Dados importados removidos pelo usuário.',
      });
    });
  }

  private async importBank(
    fileUploadId: string,
    runId: string,
    matrix: Matrix,
    t0: number,
    partialMode: 'stage' | 'commit' = 'stage',
  ) {
    const tParseStart = Date.now();
    const det = detectHeaderRowAndColumns(
      matrix,
      BANK_COLUMN_SYNONYMS,
      2,
    );
    if (!det) {
      await this.fail(
        fileUploadId,
        t0,
        'Não foi possível localizar a linha de cabeçalho ou colunas obrigatórias (favorecido/fornecedor e valor). Ajuste os títulos da planilha ou o formato.',
      );
      return;
    }
    const { headerRowIndex, columnByField } = det;
    if (
      columnByField.beneficiaryNameRaw === undefined ||
      columnByField.amount === undefined
    ) {
      await this.fail(
        fileUploadId,
        t0,
        'Colunas obrigatórias faltando: identifique colunas de fornecedor/favorecido e valor.',
      );
      return;
    }

    await this.uploadRepo.updateById(fileUploadId, {
      headerRowIndex,
      detectedColumnsJson: { bank: columnByField },
    });

    const dataStart = headerRowIndex + 1;
    const maxCol = Math.max(
      0,
      ...Object.values(columnByField).map((c) => c!),
    ) + 1;

    let dataRows: unknown[][] = [];
    for (let r = dataStart; r < matrix.length; r++) {
      const row = matrix[r];
      if (!row) continue;
      if (isRowEmpty(row as unknown[], maxCol + 2)) continue;
      dataRows.push(row as unknown[]);
    }

    const totalRows = dataRows.length;
    if (totalRows === 0) {
      await this.fail(fileUploadId, t0, 'Nenhuma linha de dado após o cabeçalho.');
      return;
    }

    const tParseEnd = Date.now();
    const parseDurationMs = tParseEnd - tParseStart;

    await this.uploadRepo.updateById(fileUploadId, {
      status: UploadStatus.IMPORTING,
      totalRowsDetected: totalRows,
      parsingFinishedAt: new Date(),
    });

    const tImport = Date.now();

    const f = columnByField as Record<BankImportField, number | undefined>;
    const toCreate: Prisma.BankRecordCreateManyInput[] = [];
    const warnings: { row: number; text: string }[] = [];
    let rejected = 0;
    let read = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] as unknown[];
      const excelRow = dataStart + i + 1;
      read++;
      const amount = parseBrAmount(getCell(row, f.amount));
      const nameRaw = toOptionalString(getCell(row, f.beneficiaryNameRaw)) ?? '';
      if (!nameRaw) {
        rejected++;
        if (warnings.length < 30) {
          warnings.push({ row: excelRow, text: 'Nome do favorecido vazio' });
        }
        if (read % PROGRESS_EVERY === 0) {
          await this.uploadRepo.updateById(fileUploadId, { totalRowsRead: read });
        }
        continue;
      }
      if (amount === null) {
        rejected++;
        if (warnings.length < 30) {
          warnings.push({ row: excelRow, text: 'Valor inválido ou vazio' });
        }
        if (read % PROGRESS_EVERY === 0) {
          await this.uploadRepo.updateById(fileUploadId, { totalRowsRead: read });
        }
        continue;
      }
      const norm = normalizeCounterpartyName(nameRaw);
      const dueDate = parseFlexibleDate(getCell(row, f.dueDate));
      const nossoNumero = toOptionalString(getCell(row, f.nossoNumero));
      toCreate.push({
        runId,
        fileUploadId,
        rowNumber: excelRow,
        dueDate,
        beneficiaryNameRaw: nameRaw,
        beneficiaryNameNorm: norm,
        beneficiaryNameCanon: null,
        payerNameRaw: toOptionalString(getCell(row, f.payerNameRaw)),
        nossoNumero,
        amount,
        importIdentityKey: bankImportIdentityKey({
          nossoNumero,
          beneficiaryNameNorm: norm,
          amount,
          dueDate,
        }),
      });
      if (read % PROGRESS_EVERY === 0) {
        await this.uploadRepo.updateById(fileUploadId, { totalRowsRead: read });
      }
    }

    const importMs = Date.now() - tImport;
    const hasWarn = warnings.length > 0 || rejected > 0;
    const isReimport = await this.detectReimport(fileUploadId);
    const dedupPlan = await planBankImportDedup(this.bankRepo, runId, toCreate);

    if (hasWarn) {
      if (toCreate.length === 0) {
        await this.fail(
          fileUploadId,
          t0,
          'Nenhuma linha válida para importar. Corrija a planilha e tente de novo.',
        );
        return;
      }
      if (partialMode === 'stage') {
        const now = new Date();
        await this.uploadRepo.updateById(fileUploadId, {
          status: UploadStatus.AWAITING_CONFIRM,
          importDurationMs: importMs,
          parseDurationMs,
          totalRowsRead: read,
          totalRowsImported: dedupPlan.inserted,
          totalRowsRejected: rejected,
          totalRowsSkipped: dedupPlan.skipped,
          totalRowsUpdated: dedupPlan.updated,
          totalRowsWithWarnings: warnings.length,
          warningDetailsJson: this.dedupSummaryJson({
            isReimport,
            samples: warnings,
          }),
          totalDurationMs: Date.now() - t0,
          finishedAt: now,
        });
        console.log(`${reconciliationImportLogPrefix} importBank → AWAITING_CONFIRM`, {
          runId,
          fileUploadId,
          partialMode,
          novas: dedupPlan.inserted,
          atualizadas: dedupPlan.updated,
          ignoradas: dedupPlan.skipped,
          rejeitadas: rejected,
          avisoAmostras: warnings.length,
          isReimport,
        });
        return;
      }
      await commitBankImportDedup(this.bankRepo, fileUploadId, dedupPlan);
      const nowC = new Date();
      await this.uploadRepo.updateById(fileUploadId, {
        status: UploadStatus.PARTIAL_SUCCESS,
        importDurationMs: importMs,
        parseDurationMs,
        totalRowsRead: read,
        totalRowsImported: dedupPlan.inserted,
        totalRowsRejected: rejected,
        totalRowsSkipped: dedupPlan.skipped,
        totalRowsUpdated: dedupPlan.updated,
        totalRowsWithWarnings: warnings.length,
        warningDetailsJson: this.dedupSummaryJson({
          isReimport,
          samples: warnings,
        }),
        totalDurationMs: Date.now() - t0,
        importedAt: nowC,
        finishedAt: nowC,
      });
      console.log(`${reconciliationImportLogPrefix} importBank → PARTIAL_SUCCESS (gravado)`, {
        runId,
        fileUploadId,
        partialMode,
        novas: dedupPlan.inserted,
        atualizadas: dedupPlan.updated,
        ignoradas: dedupPlan.skipped,
        rejeitadas: rejected,
        isReimport,
      });
      releaseUploadBuffer(fileUploadId);
      return;
    }

    await commitBankImportDedup(this.bankRepo, fileUploadId, dedupPlan);
    const nowF = new Date();
    await this.uploadRepo.updateById(fileUploadId, {
      status: UploadStatus.COMPLETED,
      importDurationMs: importMs,
      parseDurationMs,
      totalRowsRead: read,
      totalRowsImported: dedupPlan.inserted,
      totalRowsRejected: 0,
      totalRowsSkipped: dedupPlan.skipped,
      totalRowsUpdated: dedupPlan.updated,
      totalRowsWithWarnings: 0,
      warningDetailsJson: this.dedupSummaryJson({ isReimport }),
      totalDurationMs: Date.now() - t0,
      importedAt: nowF,
      finishedAt: nowF,
    });
    console.log(`${reconciliationImportLogPrefix} importBank → COMPLETED (gravado)`, {
      runId,
      fileUploadId,
      partialMode,
      novas: dedupPlan.inserted,
      atualizadas: dedupPlan.updated,
      ignoradas: dedupPlan.skipped,
      isReimport,
    });
    releaseUploadBuffer(fileUploadId);
  }

  private async importInternal(
    fileUploadId: string,
    runId: string,
    matrix: Matrix,
    t0: number,
    partialMode: 'stage' | 'commit' = 'stage',
  ) {
    const tParseStart = Date.now();
    const det = detectHeaderRowAndColumns(
      matrix,
      INTERNAL_COLUMN_SYNONYMS,
      2,
    );
    if (!det) {
      await this.fail(
        fileUploadId,
        t0,
        'Cabeçalho não reconhecido. Ajuste os títulos (fornecedor e valor são obrigatórios).',
      );
      return;
    }
    const { headerRowIndex, columnByField } = det;
    if (
      columnByField.supplierNameRaw === undefined ||
      columnByField.amount === undefined
    ) {
      await this.fail(
        fileUploadId,
        t0,
        'Colunas obrigatórias: fornecedor e valor.',
      );
      return;
    }
    preferInternalSupplierNameColumn(matrix, headerRowIndex, columnByField);
    await this.uploadRepo.updateById(fileUploadId, {
      headerRowIndex,
      detectedColumnsJson: { internal: columnByField },
    });
    const dataStart = headerRowIndex + 1;
    const col = columnByField as Record<InternalImportField, number | undefined>;
    const maxCol = Math.max(
      0,
      ...Object.values(col).map((c) => (c === undefined ? 0 : c!)),
    ) + 1;

    const dataRows: unknown[][] = [];
    for (let r = dataStart; r < matrix.length; r++) {
      const row = matrix[r];
      if (!row) continue;
      if (isRowEmpty(row as unknown[], maxCol + 2)) continue;
      dataRows.push(row as unknown[]);
    }
    const totalRows = dataRows.length;
    if (totalRows === 0) {
      await this.fail(fileUploadId, t0, 'Nenhuma linha de dado após o cabeçalho.');
      return;
    }

    const tParseEnd = Date.now();
    const parseDurationMs = tParseEnd - tParseStart;

    await this.uploadRepo.updateById(fileUploadId, {
      status: UploadStatus.IMPORTING,
      totalRowsDetected: totalRows,
      parsingFinishedAt: new Date(),
    });

    const tImport = Date.now();
    const toCreate: Prisma.InternalRecordCreateManyInput[] = [];
    const warnings: { row: number; text: string }[] = [];
    let rejected = 0;
    let read = 0;
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] as unknown[];
      const excelRow = dataStart + i + 1;
      read++;
      const nameRaw = toOptionalString(getCell(row, col.supplierNameRaw)) ?? '';
      const amount = parseBrAmount(getCell(row, col.amount));
      if (!nameRaw) {
        rejected++;
        if (warnings.length < 30) {
          warnings.push({ row: excelRow, text: 'Fornecedor vazio' });
        }
        if (read % PROGRESS_EVERY === 0) {
          await this.uploadRepo.updateById(fileUploadId, { totalRowsRead: read });
        }
        continue;
      }
      if (amount === null) {
        rejected++;
        if (warnings.length < 30) {
          warnings.push({ row: excelRow, text: 'Valor inválido' });
        }
        if (read % PROGRESS_EVERY === 0) {
          await this.uploadRepo.updateById(fileUploadId, { totalRowsRead: read });
        }
        continue;
      }
      const suplCode = toOptionalInt(getCell(row, col.supplierCode));
      const ap = parseBrAmount(getCell(row, col.amountPaid));
      const dueDate = parseFlexibleDate(getCell(row, col.dueDate));
      const invoiceNumber = toOptionalString(getCell(row, col.invoiceNumber));
      const supplierNameNorm = normalizeCounterpartyName(nameRaw);
      toCreate.push({
        runId,
        fileUploadId,
        rowNumber: excelRow,
        dueDate,
        issueDate: parseFlexibleDate(getCell(row, col.issueDate)),
        supplierCode: suplCode,
        supplierNameRaw: nameRaw,
        supplierNameNorm,
        supplierNameCanon: null,
        walletCode: toOptionalString(getCell(row, col.walletCode)),
        branchCode: toOptionalString(getCell(row, col.branchCode)),
        invoiceNumber,
        installment: toOptionalString(getCell(row, col.installment)),
        amount,
        amountPaid: ap,
        dda: toOptionalString(getCell(row, col.dda)),
        notes: toOptionalString(getCell(row, col.notes)),
        importIdentityKey: internalImportIdentityKey({
          supplierCode: suplCode,
          invoiceNumber,
          supplierNameNorm,
          amount,
          dueDate,
        }),
      });
      if (read % PROGRESS_EVERY === 0) {
        await this.uploadRepo.updateById(fileUploadId, { totalRowsRead: read });
      }
    }

    const importMs = Date.now() - tImport;
    const hasWarn = warnings.length > 0 || rejected > 0;
    const isReimport = await this.detectReimport(fileUploadId);
    const dedupPlan = await planInternalImportDedup(
      this.internalRepo,
      runId,
      toCreate,
    );

    if (hasWarn) {
      if (toCreate.length === 0) {
        await this.fail(
          fileUploadId,
          t0,
          'Nenhuma linha válida para importar. Corrija a planilha e tente de novo.',
        );
        return;
      }
      if (partialMode === 'stage') {
        const now = new Date();
        await this.uploadRepo.updateById(fileUploadId, {
          status: UploadStatus.AWAITING_CONFIRM,
          importDurationMs: importMs,
          parseDurationMs,
          totalRowsRead: read,
          totalRowsImported: dedupPlan.inserted,
          totalRowsRejected: rejected,
          totalRowsSkipped: dedupPlan.skipped,
          totalRowsUpdated: dedupPlan.updated,
          totalRowsWithWarnings: warnings.length,
          warningDetailsJson: this.dedupSummaryJson({
            isReimport,
            samples: warnings,
          }),
          totalDurationMs: Date.now() - t0,
          finishedAt: now,
        });
        console.log(
          `${reconciliationImportLogPrefix} importInternal → AWAITING_CONFIRM (ERP ainda não gravou InternalRecord até confirmar)`,
          {
            runId,
            fileUploadId,
            partialMode,
            novas: dedupPlan.inserted,
            atualizadas: dedupPlan.updated,
            ignoradas: dedupPlan.skipped,
            rejeitadas: rejected,
            avisoAmostras: warnings.length,
            isReimport,
          },
        );
        return;
      }
      await commitInternalImportDedup(this.internalRepo, fileUploadId, dedupPlan);
      const nowC = new Date();
      await this.uploadRepo.updateById(fileUploadId, {
        status: UploadStatus.PARTIAL_SUCCESS,
        importDurationMs: importMs,
        parseDurationMs,
        totalRowsRead: read,
        totalRowsImported: dedupPlan.inserted,
        totalRowsRejected: rejected,
        totalRowsSkipped: dedupPlan.skipped,
        totalRowsUpdated: dedupPlan.updated,
        totalRowsWithWarnings: warnings.length,
        warningDetailsJson: this.dedupSummaryJson({
          isReimport,
          samples: warnings,
        }),
        totalDurationMs: Date.now() - t0,
        importedAt: nowC,
        finishedAt: nowC,
      });
      console.log(`${reconciliationImportLogPrefix} importInternal → PARTIAL_SUCCESS (gravado)`, {
        runId,
        fileUploadId,
        partialMode,
        novas: dedupPlan.inserted,
        atualizadas: dedupPlan.updated,
        ignoradas: dedupPlan.skipped,
        rejeitadas: rejected,
        isReimport,
      });
      releaseUploadBuffer(fileUploadId);
      return;
    }

    await commitInternalImportDedup(this.internalRepo, fileUploadId, dedupPlan);
    const nowF = new Date();
    await this.uploadRepo.updateById(fileUploadId, {
      status: UploadStatus.COMPLETED,
      importDurationMs: importMs,
      parseDurationMs,
      totalRowsRead: read,
      totalRowsImported: dedupPlan.inserted,
      totalRowsRejected: 0,
      totalRowsSkipped: dedupPlan.skipped,
      totalRowsUpdated: dedupPlan.updated,
      totalRowsWithWarnings: 0,
      warningDetailsJson: this.dedupSummaryJson({ isReimport }),
      totalDurationMs: Date.now() - t0,
      importedAt: nowF,
      finishedAt: nowF,
    });
    console.log(`${reconciliationImportLogPrefix} importInternal → COMPLETED (gravado)`, {
      runId,
      fileUploadId,
      partialMode,
      novas: dedupPlan.inserted,
      atualizadas: dedupPlan.updated,
      ignoradas: dedupPlan.skipped,
      isReimport,
    });
    releaseUploadBuffer(fileUploadId);
  }

  /**
   * Execução mais recente da unidade (compartilhada entre usuários): prioriza run com upload mais recente;
   * senão a execução mais recente (ex.: rascunho sem arquivo ainda).
   * Uma única ida ao banco (antes: até 2 consultas sequenciais).
   */
  async getLatestRunForUnit(unit: UnitType) {
    type Row = {
      id: string;
      title: string | null;
      status: RunStatus;
      unit: UnitType;
    };
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH upload_pick AS (
        SELECT r.id, r.title, r.status, r.unit
        FROM "FileUpload" fu
        INNER JOIN "ReconciliationRun" r ON r.id = fu."runId"
        WHERE r.unit = ${unit}::"UnitType"
          AND r.status <> 'CLOSED'::"RunStatus"
        ORDER BY fu."updatedAt" DESC
        LIMIT 1
      ),
      fallback_pick AS (
        SELECT r.id, r.title, r.status, r.unit
        FROM "ReconciliationRun" r
        WHERE r.unit = ${unit}::"UnitType"
          AND r.status <> 'CLOSED'::"RunStatus"
        ORDER BY r."createdAt" DESC
        LIMIT 1
      )
      SELECT id, title, status, unit FROM (
        SELECT id, title, status, unit FROM upload_pick
        UNION ALL
        SELECT id, title, status, unit FROM fallback_pick
        WHERE NOT EXISTS (SELECT 1 FROM upload_pick)
      ) AS resolved
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /**
   * Gera e persiste sugestões de vínculo no banco (chamada explícita após importar).
   * Exige ao menos um lado (banco ou interno) com lançamentos gravados.
   */
  async finalizeRunWithSuggestions(runId: string, userId: string) {
    await new ReconciliationRunService().assertRunOpenForImport(runId);
    const run = await prisma.reconciliationRun.findFirst({
      where: { id: runId },
    });
    if (!run) {
      throw new HttpError('Execução não encontrada ou acesso negado', 404);
    }
    const [bankC, intC] = await Promise.all([
      prisma.bankRecord.count({ where: { runId } }),
      prisma.internalRecord.count({ where: { runId } }),
    ]);
    console.log(`${reconciliationImportLogPrefix} finalize solicitado`, {
      runId,
      requestedByUserId: userId,
      bankRecordCount: bankC,
      internalRecordCount: intC,
    });
    if (bankC === 0 && intC === 0) {
      console.warn(`${reconciliationImportLogPrefix} finalize bloqueado (nenhum lançamento gravado)`, {
        runId,
        bankRecordCount: bankC,
        internalRecordCount: intC,
      });
      throw new HttpError(
        'Importe e confirme ao menos uma planilha (banco ou sistema interno) antes de gerar os vínculos.',
        400,
      );
    }
    const result = await generateMatchSuggestionsForRun(runId);
    console.log(`${reconciliationImportLogPrefix} finalize OK`, {
      runId,
      sugestoesCriadas: result.created,
      bankRecordCount: bankC,
      internalRecordCount: intC,
    });
    return { ...result, bankRecordCount: bankC, internalRecordCount: intC };
  }
}
