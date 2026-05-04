import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  BankExtratoMatchKind,
  SuggestionStatus,
} from '../generated/prisma/enums.js';
import { env } from '../env/index.js';
import { HttpError } from '../http/erros/index.js';
import {
  extratoRequiredColumnsPresent,
  mapExtratoHeaderRow,
} from '../lib/excel/extrato-column-maps.js';
import {
  isRowEmpty,
  parseBrAmount,
  parseFlexibleDate,
} from '../lib/excel/spreadsheet-helpers.js';
import { normalizeCounterpartyName } from '../lib/name-normalize.js';
import { prisma } from '../lib/prisma.js';
import {
  MIN_NAME_SCORE_CANDIDATE_LIST,
  nameMatchScore,
  type ScoringBankRow,
  type ScoringInternalRow,
} from './suggestion-pair-scoring.js';

const UPLOAD_DIR_ABS = resolve(process.cwd(), env.UPLOAD_DIR);
const MIN_AUTO_NAME_SCORE = 88;
const SHEET_ROW_CAP = 50_000;

type Matrix = unknown[][];

function getCell(row: unknown[], col: number | undefined): unknown {
  if (col === undefined) return null;
  return row[col] ?? null;
}

function toOptionalStr(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function sheetToMatrix(worksheet: XLSX.WorkSheet): Matrix {
  const m = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];
  if (!m.length) return [[]];
  return m.length > SHEET_ROW_CAP ? m.slice(0, SHEET_ROW_CAP) : m;
}

type PaidSuggestionBundle = {
  id: string;
  amountDecimal: Prisma.Decimal;
  bankPseudo: ScoringBankRow | null;
  internalPseudo: ScoringInternalRow | null;
};

function buildPaidBundle(s: {
  id: string;
  bankLinks: {
    bankRecord: {
      beneficiaryNameRaw: string;
      beneficiaryNameNorm: string | null;
      amount: Prisma.Decimal;
      dueDate: Date | null;
    };
  }[];
  internalLinks: {
    internalRecord: {
      supplierNameRaw: string;
      supplierNameNorm: string | null;
      amount: Prisma.Decimal;
      dueDate: Date | null;
    };
  }[];
}): PaidSuggestionBundle | null {
  const banks = s.bankLinks.map((l) => l.bankRecord);
  const inners = s.internalLinks.map((l) => l.internalRecord);
  if (inners.length === 0 && banks.length === 0) return null;

  let amountDecimal: Prisma.Decimal | null = null;
  if (banks[0]) {
    amountDecimal = banks[0]!.amount;
  }
  if (inners.length === 1) {
    amountDecimal = inners[0]!.amount;
  } else if (inners.length > 1) {
    amountDecimal = inners.reduce(
      (a, r) => a.add(r.amount),
      new Prisma.Decimal(0),
    );
  }
  if (!amountDecimal) return null;

  const bankPseudo: ScoringBankRow | null = banks[0]
    ? {
        beneficiaryNameRaw: banks[0]!.beneficiaryNameRaw,
        beneficiaryNameNorm: banks[0]!.beneficiaryNameNorm,
        amount: banks[0]!.amount,
        dueDate: banks[0]!.dueDate,
      }
    : null;

  const internalPseudo: ScoringInternalRow | null = inners[0]
    ? {
        supplierNameRaw: inners[0]!.supplierNameRaw,
        supplierNameNorm: inners[0]!.supplierNameNorm,
        amount: amountDecimal,
        dueDate: inners[0]!.dueDate,
      }
    : null;

  return {
    id: s.id,
    amountDecimal,
    bankPseudo,
    internalPseudo,
  };
}

/** Nota nome extrato × sugestão (melhor lado ERP / banco disponível). */
function extratoNameScoreAgainstSuggestion(
  extRow: ScoringBankRow,
  b: PaidSuggestionBundle,
): number {
  let best = 0;
  if (b.internalPseudo) {
    best = Math.max(best, nameMatchScore(extRow, b.internalPseudo));
  }
  if (b.bankPseudo && b.internalPseudo) {
    const rev = nameMatchScore(
      b.bankPseudo,
      {
        supplierNameRaw: extRow.beneficiaryNameRaw,
        supplierNameNorm: extRow.beneficiaryNameNorm,
        amount: extRow.amount,
        dueDate: extRow.dueDate,
      },
    );
    best = Math.max(best, rev);
  } else if (b.bankPseudo) {
    const fakeInternal: ScoringInternalRow = {
      supplierNameRaw: extRow.beneficiaryNameRaw,
      supplierNameNorm: extRow.beneficiaryNameNorm,
      amount: extRow.amount,
      dueDate: extRow.dueDate,
    };
    best = Math.max(best, nameMatchScore(b.bankPseudo!, fakeInternal));
  }
  return best;
}

function amountsEqual(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  return a.toDecimalPlaces(2).equals(b.toDecimalPlaces(2));
}

type DbClient = PrismaClient | Prisma.TransactionClient;

const EXTRATO_PAID_SUGGESTION_INCLUDE = {
  bankLinks: {
    include: {
      bankRecord: {
        select: {
          beneficiaryNameRaw: true,
          beneficiaryNameNorm: true,
          amount: true,
          dueDate: true,
        },
      },
    },
  },
  internalLinks: {
    include: {
      internalRecord: {
        select: {
          supplierNameRaw: true,
          supplierNameNorm: true,
          amount: true,
          dueDate: true,
        },
      },
    },
  },
} as const;

/**
 * Todas as sugestões marcadas como pagas no run entram no pool de casamento com o extrato.
 * Não filtramos por data de vencimento: itens sem `dueDate` nos vínculos ou com vencimento fora
 * da janela da lista ainda precisam casar após “marcar como pago”.
 */
async function loadPaidSuggestionsForExtrato(db: DbClient, runId: string) {
  return db.matchSuggestion.findMany({
    where: {
      runId,
      paidAt: { not: null },
      status: { notIn: [SuggestionStatus.REJECTED, SuggestionStatus.IGNORED] },
    },
    include: EXTRATO_PAID_SUGGESTION_INCLUDE,
  });
}

function buildBundles(
  paidSuggestions: Awaited<ReturnType<typeof loadPaidSuggestionsForExtrato>>,
): Map<string, PaidSuggestionBundle> {
  const bundles = new Map<string, PaidSuggestionBundle>();
  for (const s of paidSuggestions) {
    const b = buildPaidBundle(
      s as unknown as Parameters<typeof buildPaidBundle>[0],
    );
    if (b) {
      bundles.set(s.id, b);
    }
  }
  return bundles;
}

/**
 * Tenta casar automaticamente linhas do extrato ainda sem vínculo com contas
 * pagas ainda sem par neste import. Preserva matches manuais.
 */
async function runAutoMatchForImportTx(
  tx: DbClient,
  importId: string,
): Promise<number> {
  const imp = await tx.bankExtratoImport.findUnique({
    where: { id: importId },
    select: {
      id: true,
      runId: true,
    },
  });
  if (!imp) {
    return 0;
  }
  const paidSuggestions = await loadPaidSuggestionsForExtrato(tx, imp.runId);
  const bundles = buildBundles(paidSuggestions);
  if (bundles.size === 0) {
    return 0;
  }

  const existing = await tx.bankExtratoSuggestionMatch.findMany({
    where: { extratoImportId: importId },
    select: { suggestionId: true },
  });
  const usedSuggestionIds = new Set<string>();
  for (const m of existing) {
    usedSuggestionIds.add(m.suggestionId);
  }

  const availableSuggestionIds = new Set(
    [...bundles.keys()].filter((id) => !usedSuggestionIds.has(id)),
  );
  if (availableSuggestionIds.size === 0) {
    return 0;
  }

  const allLines = await tx.bankExtratoLine.findMany({
    where: { extratoImportId: importId },
    include: {
      match: { select: { id: true, matchKind: true } },
    },
    orderBy: { rowNumber: 'asc' },
  });

  const unmatched = allLines.filter((l) => l.match == null);
  let newMatches = 0;
  for (const line of unmatched) {
    const extAsBank: ScoringBankRow = {
      beneficiaryNameRaw: line.beneficiaryRaw,
      beneficiaryNameNorm: line.beneficiaryNorm,
      amount: line.amount,
      dueDate: line.paymentDate,
    };

    function collectCandidates(minNameScore: number): string[] {
      const c: string[] = [];
      for (const sid of availableSuggestionIds) {
        const b = bundles.get(sid)!;
        if (!amountsEqual(b.amountDecimal, line.amount)) continue;
        const ns = extratoNameScoreAgainstSuggestion(extAsBank, b);
        if (ns >= minNameScore) {
          c.push(sid);
        }
      }
      return c;
    }

    let candidates = collectCandidates(MIN_AUTO_NAME_SCORE);
    if (candidates.length === 0) {
      candidates = collectCandidates(MIN_NAME_SCORE_CANDIDATE_LIST);
    }

    if (candidates.length === 1) {
      const sid = candidates[0]!;
      await tx.bankExtratoSuggestionMatch.create({
        data: {
          extratoImportId: importId,
          extratoLineId: line.id,
          suggestionId: sid,
          matchKind: BankExtratoMatchKind.AUTO,
          justification: null,
          createdById: null,
        },
      });
      availableSuggestionIds.delete(sid);
      newMatches += 1;
    }
  }
  return newMatches;
}

function parseReferenceDateYmd(
  referenceDate: string | undefined,
  matrix: Matrix,
  colMap: Partial<
    Record<'paymentDate' | 'beneficiary' | 'amount', number | undefined>
  >,
): string {
  if (referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    return referenceDate;
  }
  const dc = colMap.paymentDate;
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || isRowEmpty(row, row.length)) continue;
    const d = parseFlexibleDate(getCell(row, dc));
    if (!d) continue;
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export class BankExtratoService {
  async importBuffer(params: {
    runId: string;
    userId: string;
    buffer: Buffer;
    originalFileName: string;
    referenceDateYmd?: string | undefined;
    compareFromYmd: string;
    compareToYmd: string;
  }): Promise<{
    importId: string;
    referenceDate: string;
    linesImported: number;
    autoMatches: number;
  }> {
    const run = await prisma.reconciliationRun.findUnique({
      where: { id: params.runId },
    });
    if (!run) {
      throw new HttpError('Execução de conciliação não encontrada', 404);
    }

    const workbook = XLSX.read(params.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new HttpError('Planilha sem abas', 400);
    }
    const matrix = sheetToMatrix(workbook.Sheets[sheetName]!);

    let headerRowIdx = -1;
    let colMap: ReturnType<typeof mapExtratoHeaderRow> | null = null;
    for (let i = 0; i < Math.min(matrix.length, 15); i++) {
      const row = matrix[i];
      if (!row || isRowEmpty(row, row.length)) continue;
      const m = mapExtratoHeaderRow(row);
      if (extratoRequiredColumnsPresent(m)) {
        headerRowIdx = i;
        colMap = m;
        break;
      }
    }
    if (headerRowIdx < 0 || !colMap) {
      throw new HttpError(
        'Cabeçalho não reconhecido. É necessário Favorecido e Valor.',
        400,
      );
    }

    const referenceYmd =
      params.referenceDateYmd &&
      /^\d{4}-\d{2}-\d{2}$/.test(params.referenceDateYmd)
        ? params.referenceDateYmd
        : parseReferenceDateYmd(undefined, matrix, {
            paymentDate: colMap.paymentDate,
            beneficiary: colMap.beneficiary,
            amount: colMap.amount,
          });

    const refDateUtc = new Date(`${referenceYmd}T12:00:00.000Z`);

    await mkdir(UPLOAD_DIR_ABS, { recursive: true });
    const storedName = `extrato_${randomUUID()}.xlsx`;
    const storagePath = join('extratos', storedName);
    const absPath = resolve(UPLOAD_DIR_ABS, storagePath);
    await mkdir(resolve(UPLOAD_DIR_ABS, 'extratos'), { recursive: true });
    await writeFile(absPath, params.buffer);

    const lineRows: {
      rowNumber: number;
      paymentDate: Date | null;
      beneficiaryRaw: string;
      beneficiaryNorm: string | null;
      documentNumberRaw: string | null;
      paymentNumberRaw: string | null;
      clientNumberRaw: string | null;
      amount: Prisma.Decimal;
      paymentTypeRaw: string | null;
      statusRaw: string | null;
      channelRaw: string | null;
    }[] = [];

    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      const row = matrix[r];
      if (!row || isRowEmpty(row, row.length)) continue;
      const beneficiaryRaw =
        toOptionalStr(getCell(row, colMap.beneficiary)) ?? '';
      if (!beneficiaryRaw) continue;

      const amount = parseBrAmount(getCell(row, colMap.amount));
      if (amount === null || amount.equals(0)) continue;

      const paymentDateRaw = parseFlexibleDate(
        getCell(row, colMap.paymentDate),
      );

      lineRows.push({
        rowNumber: r + 1,
        paymentDate: paymentDateRaw,
        beneficiaryRaw,
        beneficiaryNorm: normalizeCounterpartyName(beneficiaryRaw) || null,
        documentNumberRaw: toOptionalStr(
          getCell(row, colMap.documentNumber),
        ),
        paymentNumberRaw: toOptionalStr(getCell(row, colMap.paymentNumber)),
        clientNumberRaw: toOptionalStr(getCell(row, colMap.clientNumber)),
        amount,
        paymentTypeRaw: toOptionalStr(getCell(row, colMap.paymentType)),
        statusRaw: toOptionalStr(getCell(row, colMap.status)),
        channelRaw: toOptionalStr(getCell(row, colMap.channel)),
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.bankExtratoImport.deleteMany({
        where: {
          runId: params.runId,
          referenceDate: refDateUtc,
        },
      });

      const createdImport = await tx.bankExtratoImport.create({
        data: {
          runId: params.runId,
          uploadedById: params.userId,
          originalFileName: params.originalFileName,
          storagePath,
          referenceDate: refDateUtc,
          compareFromYmd: params.compareFromYmd,
          compareToYmd: params.compareToYmd,
        },
      });

      if (lineRows.length === 0) {
        return {
          importId: createdImport.id,
          referenceDate: referenceYmd,
          linesImported: 0,
          autoMatches: 0,
        };
      }

      await tx.bankExtratoLine.createMany({
        data: lineRows.map((lr) => ({
          extratoImportId: createdImport.id,
          rowNumber: lr.rowNumber,
          paymentDate: lr.paymentDate,
          beneficiaryRaw: lr.beneficiaryRaw,
          beneficiaryNorm: lr.beneficiaryNorm,
          documentNumberRaw: lr.documentNumberRaw,
          paymentNumberRaw: lr.paymentNumberRaw,
          clientNumberRaw: lr.clientNumberRaw,
          amount: lr.amount,
          paymentTypeRaw: lr.paymentTypeRaw,
          statusRaw: lr.statusRaw,
          channelRaw: lr.channelRaw,
        })),
      });

      const createdLines = await tx.bankExtratoLine.findMany({
        where: { extratoImportId: createdImport.id },
        orderBy: { rowNumber: 'asc' },
      });

      const autoMatches = await runAutoMatchForImportTx(tx, createdImport.id);

      return {
        importId: createdImport.id,
        referenceDate: referenceYmd,
        linesImported: createdLines.length,
        autoMatches,
      };
    });

    return result;
  }

  async getState(params: {
    runId: string;
    referenceDateYmd: string;
  }): Promise<{
    import: null | {
      id: string;
      referenceDate: string;
      originalFileName: string;
      createdAt: string;
    };
    extratoLines: Array<{
      id: string;
      rowNumber: number;
      paymentDate: string | null;
      beneficiaryRaw: string;
      amount: string;
      paymentTypeRaw: string | null;
      matchedSuggestionId: string | null;
      matchKind: BankExtratoMatchKind | null;
      justification: string | null;
    }>;
  }> {
    const run = await prisma.reconciliationRun.findUnique({
      where: { id: params.runId },
    });
    if (!run) {
      throw new HttpError('Execução de conciliação não encontrada', 404);
    }

    const refDateUtc = new Date(`${params.referenceDateYmd}T12:00:00.000Z`);

    const imp = await prisma.bankExtratoImport.findUnique({
      where: {
        runId_referenceDate: {
          runId: params.runId,
          referenceDate: refDateUtc,
        },
      },
      include: {
        lines: {
          orderBy: { rowNumber: 'asc' },
          include: { match: true },
        },
      },
    });

    if (!imp) {
      return { import: null, extratoLines: [] };
    }

    return {
      import: {
        id: imp.id,
        referenceDate: params.referenceDateYmd,
        originalFileName: imp.originalFileName,
        createdAt: imp.createdAt.toISOString(),
      },
      extratoLines: imp.lines.map((l) => ({
        id: l.id,
        rowNumber: l.rowNumber,
        paymentDate: l.paymentDate
          ? l.paymentDate.toLocaleDateString('en-CA', {
              timeZone: 'America/Sao_Paulo',
            })
          : null,
        beneficiaryRaw: l.beneficiaryRaw,
        amount: l.amount.toString(),
        paymentTypeRaw: l.paymentTypeRaw,
        matchedSuggestionId: l.match?.suggestionId ?? null,
        matchKind: l.match?.matchKind ?? null,
        justification: l.match?.justification ?? null,
      })),
    };
  }

  async manualMatch(params: {
    runId: string;
    userId: string;
    extratoLineId: string;
    suggestionId: string;
    justification: string;
  }): Promise<{ ok: true }> {
    const j = params.justification.trim();
    if (j.length < 3) {
      throw new HttpError('Justificativa é obrigatória (mín. 3 caracteres).', 400);
    }

    const line = await prisma.bankExtratoLine.findFirst({
      where: { id: params.extratoLineId },
      include: {
        extratoImport: true,
        match: true,
      },
    });
    if (!line || line.extratoImport.runId !== params.runId) {
      throw new HttpError('Linha de extrato não encontrada nesta execução.', 404);
    }
    if (line.match) {
      throw new HttpError('Esta linha do extrato já está vinculada.', 400);
    }

    const suggestion = await prisma.matchSuggestion.findFirst({
      where: { id: params.suggestionId, runId: params.runId },
    });
    if (!suggestion || !suggestion.paidAt) {
      throw new HttpError(
        'Sugestão não encontrada ou não está marcada como paga.',
        400,
      );
    }

    const existingSug = await prisma.bankExtratoSuggestionMatch.findFirst({
      where: {
        extratoImportId: line.extratoImportId,
        suggestionId: params.suggestionId,
      },
    });
    if (existingSug) {
      throw new HttpError(
        'Esta conta já está vinculada a outra linha deste extrato.',
        400,
      );
    }

    await prisma.bankExtratoSuggestionMatch.create({
      data: {
        extratoImportId: line.extratoImportId,
        extratoLineId: line.id,
        suggestionId: params.suggestionId,
        matchKind: BankExtratoMatchKind.MANUAL,
        justification: j,
        createdById: params.userId,
      },
    });

    return { ok: true };
  }

  /**
   * Reaplica o casamento automático em todos os extratos importados do run
   * (ex.: após marcar uma conta como paga na conciliação).
   */
  async reapplyAutoMatchForRun(runId: string): Promise<void> {
    const imports = await prisma.bankExtratoImport.findMany({
      where: { runId },
      select: { id: true },
    });
    if (imports.length === 0) {
      return;
    }
    await prisma.$transaction(async (tx) => {
      for (const { id } of imports) {
        await runAutoMatchForImportTx(tx, id);
      }
    });
  }
}
