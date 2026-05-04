import { Prisma } from '../generated/prisma/client.js';
import {
  PaymentVinculoKind,
  SuggestionReason,
  SuggestionStatus,
  TriageBucket,
} from '../generated/prisma/enums.js';
import { normalizeCounterpartyName } from '../lib/name-normalize.js';
import { prisma } from '../lib/prisma.js';
import {
  computeFinalReason,
  matchKey,
  MIN_NAME_SCORE_CANDIDATE_LIST,
  nameMatchScore,
  namesAreStrictlyEqual,
  triageForMatchedName,
  type ScoringBankRow,
  type ScoringInternalRow,
} from './suggestion-pair-scoring.js';

type BankRow = ScoringBankRow & { id: string };
type InternalRow = ScoringInternalRow & { id: string };

/**
 * Gera sugestões de vínculo para a execução, substituindo as anteriores.
 * Pareia banco e ERP por valor e vencimento (mesmo **dia** em
 * `America/Sao_Paulo`, alinhado ao `dueDate` persistido) e, em duplicata,
 * escolhe a linha do ERP de nome mais semelhante.
 *
 * O motivo `MULTIPLE_CANDIDATES` só ocorre quando, naquele valor+data, existem
 * **dois ou mais** internos com nota de nome ≥ `MIN_NAME_SCORE_CANDIDATE_LIST` (25)
 * frente ao **mesmo** banco. Coincidir só por valor, com 0% de similaridade
 * de nome, não gera “vários candidatos” (o melhor par segue FUZZY/VALOR etc.).
 */
export async function generateMatchSuggestionsForRun(
  runId: string,
): Promise<{ created: number }> {
  const [banks, internals, vinculoByKind] = await Promise.all([
    prisma.bankRecord.findMany({
      where: { runId },
      orderBy: { id: 'asc' },
    }),
    prisma.internalRecord.findMany({
      where: { runId },
      orderBy: { id: 'asc' },
    }),
    Promise.all([
      prisma.paymentVinculoName.findMany({
        where: { kind: PaymentVinculoKind.PIX },
        select: { normalizedName: true },
      }),
      prisma.paymentVinculoName.findMany({
        where: { kind: PaymentVinculoKind.TED },
        select: { normalizedName: true },
      }),
    ]),
  ]);
  const [pixNormRows, tedNormRows] = vinculoByKind;
  const pixNormSet = new Set(pixNormRows.map((r) => r.normalizedName));
  const tedNormSet = new Set(tedNormRows.map((r) => r.normalizedName));

  const pool = new Map<string, InternalRow[]>();
  for (const ir of internals) {
    const k = matchKey(ir.amount, ir.dueDate);
    if (!pool.has(k)) {
      pool.set(k, []);
    }
    pool.get(k)!.push({ ...ir });
  }
  for (const arr of pool.values()) {
    arr.sort((x, y) => x.id.localeCompare(y.id));
  }

  await prisma.matchSuggestion.deleteMany({ where: { runId } });

  type Row = {
    triageBucket: TriageBucket;
    reason: SuggestionReason;
    scorePercent: number;
    nameScore: number;
    amountScore: number;
    dateScore: number;
    amountDiff: Prisma.Decimal | null;
    bankIds: string[];
    internalIds: string[];
  };

  const toInsert: Row[] = [];

  for (const b of banks) {
    const k = matchKey(b.amount, b.dueDate);
    const arr = pool.get(k) ?? [];
    if (arr.length === 0) {
      toInsert.push({
        triageBucket: TriageBucket.BANK_ONLY,
        reason: SuggestionReason.NO_INTERNAL_MATCH,
        scorePercent: 0,
        nameScore: 0,
        amountScore: 0,
        dateScore: 0,
        amountDiff: null,
        bankIds: [b.id],
        internalIds: [],
      });
      continue;
    }
    /**
     * "Vários candidatos" só se, para este banco, existir **mais de um** interno
     * no mesmo valor+data com nota de nome acima do piso (igual à triagem de candidatos
     * no diálogo). Só coincidir valor/venc. com nomes 0% entre si não gera ambiguidade
     * de nome (fica FUZZY/VALOR/só exato conforme o melhor par).
     */
    const plausibleCount = arr.filter(
      (ir) =>
        nameMatchScore(
          b as BankRow,
          ir as InternalRow,
        ) >= MIN_NAME_SCORE_CANDIDATE_LIST,
    ).length;
    const hadMulti = plausibleCount > 1;
    let bestIdx = 0;
    let bestInternal = arr[0]!;
    let bestName = nameMatchScore(
      b as BankRow,
      bestInternal as InternalRow,
    );
    for (let i = 1; i < arr.length; i++) {
      const c = nameMatchScore(
        b as BankRow,
        arr[i]! as InternalRow,
      );
      if (c > bestName) {
        bestName = c;
        bestIdx = i;
        bestInternal = arr[i]!;
      }
    }
    arr.splice(bestIdx, 1);
    if (arr.length === 0) {
      pool.delete(k);
    } else {
      pool.set(k, arr);
    }
    const diff = b.amount.minus((bestInternal as { amount: Prisma.Decimal }).amount);
    const hasDiff = !diff.equals(0);
    const strictEqual = namesAreStrictlyEqual(
      b as BankRow,
      bestInternal as InternalRow,
    );
    const reason = computeFinalReason(bestName, hadMulti, strictEqual);
    const overall = Math.max(
      0,
      Math.min(
        100,
        Math.round((bestName + 100 + 100) / 3),
      ),
    );
    toInsert.push({
      triageBucket: triageForMatchedName(bestName),
      reason,
      scorePercent: overall,
      nameScore: bestName,
      amountScore: 100,
      dateScore: 100,
      amountDiff: hasDiff ? diff : null,
      bankIds: [b.id],
      internalIds: [bestInternal.id],
    });
  }

  for (const [, left] of pool) {
    for (const ir of left) {
      const n = normalizeCounterpartyName(ir.supplierNameRaw);
      const reason = (() => {
        if (n.length === 0) {
          return SuggestionReason.NO_BANK_MATCH;
        }
        if (pixNormSet.has(n)) {
          return SuggestionReason.PIX_CANDIDATE;
        }
        if (tedNormSet.has(n)) {
          return SuggestionReason.TED_CANDIDATE;
        }
        return SuggestionReason.NO_BANK_MATCH;
      })();
      toInsert.push({
        triageBucket: TriageBucket.INTERNAL_ONLY,
        reason,
        scorePercent: 0,
        nameScore: 0,
        amountScore: 0,
        dateScore: 0,
        amountDiff: null,
        bankIds: [],
        internalIds: [ir.id],
      });
    }
  }

  let created = 0;
  for (const row of toInsert) {
    await prisma.matchSuggestion.create({
      data: {
        runId,
        status: SuggestionStatus.OPEN,
        triageBucket: row.triageBucket,
        reason: row.reason,
        scorePercent: row.scorePercent,
        nameScore: row.nameScore,
        amountScore: row.amountScore,
        dateScore: row.dateScore,
        ambiguityPenalty: 0,
        amountDifference: row.amountDiff ?? undefined,
        ...((row.bankIds.length > 0
          ? {
              bankLinks: {
                create: row.bankIds.map((id) => ({
                  bankRecordId: id,
                })),
              },
            }
          : {}) as object),
        ...((row.internalIds.length > 0
          ? {
              internalLinks: {
                create: row.internalIds.map((id) => ({
                  internalRecordId: id,
                })),
              },
            }
          : {}) as object),
      },
    });
    created += 1;
  }

  return { created };
}
