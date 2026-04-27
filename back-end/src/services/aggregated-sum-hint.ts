import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import {
  type ScoringBankRow,
  type ScoringInternalRow,
  nameMatchScore,
  MIN_NAME_SCORE_CANDIDATE_LIST,
} from './suggestion-pair-scoring.js';
import { findAmountSubsetsEqualing } from './internal-amount-subset.js';

function moneyDecimalToCents(d: Prisma.Decimal): number {
  return parseInt(d.mul(100).round().toString(), 10);
}

function isoDateOrNull(d: Date | null): string | null {
  if (!d) {
    return null;
  }
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export type PoolRow = {
  id: string;
  cents: number;
  dueDate: Date | null;
  supplierNameRaw: string;
  supplierNameNorm: string | null;
};

/** 1ª passada: prioridade ao mesmo dia do extrato, depois id. */
export const MAX_ITEMS_SUBSET_PASS1 = 72;
/** 2ª passada (só se a 1ª não achar e houver > pass1 elegíveis): só id, teto maior. */
export const MAX_ITEMS_SUBSET_PASS2 = 120;

/**
 * Dados mínimos por título (valor / data) + nomes para cruzar com o extrato.
 * `supplierNameRaw` vazio gera 0% de nota nesse título.
 */
export type RowForSubset = {
  id: string;
  cents: number;
  dueDate: Date | null;
  supplierNameRaw?: string;
  supplierNameNorm?: string | null;
};

const ZERO = new Prisma.Decimal(0);

function internalScoringForRow(r: RowForSubset): ScoringInternalRow {
  return {
    amount: ZERO,
    dueDate: null,
    supplierNameRaw: (r.supplierNameRaw ?? '').trim(),
    supplierNameNorm: r.supplierNameNorm ?? null,
  };
}

export function nameMatchBankVsInternalRow(
  bank: ScoringBankRow,
  r: RowForSubset,
): number {
  if (!(r.supplierNameRaw ?? '').trim()) {
    return 0;
  }
  return nameMatchScore(bank, internalScoringForRow(r));
}

function minNameInCombination(
  bank: ScoringBankRow,
  ids: string[],
  byId: Map<string, RowForSubset>,
): number {
  if (ids.length === 0) {
    return 0;
  }
  let m = 100;
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) {
      return 0;
    }
    const s = nameMatchBankVsInternalRow(bank, r);
    if (s < m) {
      m = s;
    }
  }
  return m;
}

function avgNameInCombination(
  bank: ScoringBankRow,
  ids: string[],
  byId: Map<string, RowForSubset>,
): number {
  if (ids.length === 0) {
    return 0;
  }
  let t = 0;
  for (const id of ids) {
    const r = byId.get(id);
    t += r ? nameMatchBankVsInternalRow(bank, r) : 0;
  }
  return Math.round(t / ids.length);
}

function rowById(rows: RowForSubset[]): Map<string, RowForSubset> {
  const m = new Map<string, RowForSubset>();
  for (const r of rows) {
    if (!m.has(r.id)) {
      m.set(r.id, r);
    }
  }
  return m;
}

function filterCombosByMinName(
  bank: ScoringBankRow,
  combos: string[][],
  byId: Map<string, RowForSubset>,
  minScore: number,
  maxReturn: number,
): string[][] {
  const ok = combos.filter(
    (ids) => minNameInCombination(bank, ids, byId) >= minScore,
  );
  ok.sort(
    (a, b) =>
      avgNameInCombination(bank, b, byId) -
        avgNameInCombination(bank, a, byId) ||
      a.length - b.length,
  );
  return ok.slice(0, maxReturn);
}

/**
 * Reduz o pool às linhas que podem, em tese, participar de uma soma = alvo
 * (0 < parcela ≤ alvo) e, se ainda forem muitas, prioriza o mesmo dia do
 * extrato antes de truncar.
 */
export function prepareItemsForInternalSumSubsets(
  rows: RowForSubset[],
  targetCents: number,
  bankDayYmd: string | null,
  maxItems: number = MAX_ITEMS_SUBSET_PASS1,
): { id: string; cents: number }[] {
  if (targetCents <= 0) {
    return [];
  }
  const byI = new Map<string, RowForSubset>();
  for (const r of rows) {
    if (!byI.has(r.id)) {
      byI.set(r.id, r);
    }
  }
  const candidates = [...byI.values()].filter(
    (r) => r.cents > 0 && r.cents <= targetCents,
  );
  if (candidates.length <= maxItems) {
    return candidates
      .map((r) => ({ id: r.id, cents: r.cents }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  const dayRank = (d: Date | null) =>
    bankDayYmd != null && isoDateOrNull(d) === bankDayYmd ? 0 : 1;
  return [...candidates]
    .sort(
      (a, b) =>
        dayRank(a.dueDate) - dayRank(b.dueDate) || a.id.localeCompare(b.id),
    )
    .slice(0, maxItems)
    .map((r) => ({ id: r.id, cents: r.cents }));
}

function prepareItemsIdOnlyTruncated(
  rows: RowForSubset[],
  targetCents: number,
  maxItems: number,
): { id: string; cents: number }[] {
  if (targetCents <= 0) {
    return [];
  }
  const byI = new Map<string, RowForSubset>();
  for (const r of rows) {
    if (!byI.has(r.id)) {
      byI.set(r.id, r);
    }
  }
  const candidates = [...byI.values()].filter(
    (r) => r.cents > 0 && r.cents <= targetCents,
  );
  if (candidates.length <= maxItems) {
    return candidates
      .map((r) => ({ id: r.id, cents: r.cents }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  return [...candidates]
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, maxItems)
    .map((r) => ({ id: r.id, cents: r.cents }));
}

function countRowsEligibleForSum(
  rows: RowForSubset[],
  targetCents: number,
): number {
  if (targetCents <= 0) {
    return 0;
  }
  const byI = new Map<string, RowForSubset>();
  for (const r of rows) {
    if (!byI.has(r.id)) {
      byI.set(r.id, r);
    }
  }
  return [...byI.values()].filter(
    (r) => r.cents > 0 && r.cents <= targetCents,
  ).length;
}

/**
 * Soma em centavos, sem regra de nome.
 */
function findInternalRecordSubsetsForBankAmountCore(
  rows: RowForSubset[],
  targetCents: number,
  bankDayYmd: string | null,
  minSize: number,
  maxResults: number,
  maxSubsetSearchResults: number = maxResults,
): {
  combinations: string[][];
  maxCandidatesConsidered: number;
  totalEligible: number;
} {
  if (minSize < 1 || maxResults < 1) {
    return { combinations: [], maxCandidatesConsidered: 0, totalEligible: 0 };
  }
  const totalEligible = countRowsEligibleForSum(rows, targetCents);
  if (totalEligible < minSize) {
    return {
      combinations: [],
      maxCandidatesConsidered: totalEligible,
      totalEligible,
    };
  }
  const items1 = prepareItemsForInternalSumSubsets(
    rows,
    targetCents,
    bankDayYmd,
    MAX_ITEMS_SUBSET_PASS1,
  );
  const c1 = findAmountSubsetsEqualing(
    items1,
    targetCents,
    minSize,
    maxSubsetSearchResults,
  );
  if (c1.length > 0) {
    return {
      combinations: c1.slice(0, maxResults),
      maxCandidatesConsidered: items1.length,
      totalEligible,
    };
  }
  if (totalEligible <= MAX_ITEMS_SUBSET_PASS1) {
    return {
      combinations: [],
      maxCandidatesConsidered: items1.length,
      totalEligible,
    };
  }
  const items2 = prepareItemsIdOnlyTruncated(
    rows,
    targetCents,
    MAX_ITEMS_SUBSET_PASS2,
  );
  const c2 = findAmountSubsetsEqualing(
    items2,
    targetCents,
    minSize,
    maxSubsetSearchResults,
  );
  return {
    combinations: c2.slice(0, maxResults),
    maxCandidatesConsidered: items2.length,
    totalEligible,
  };
}

const SUBSET_CANDIDATES_TO_INSPECT_FOR_NAME = 32;

/**
 * 1) Subconjunto só com títulos cujo nome já é plausível (≥ piso) vs. o extrato.
 * 2) Soma geral, depois filtra combinações em que **cada** título ≥ piso
 *    (cobre “um título fica de fora” no pool 1 se o recorte ainda atrapalhar).
 * 3) Se nada com nome, devolve a mesma lógica só valor (`amount_only`).
 */
export function findInternalRecordSubsetsForBankAmount(
  rows: RowForSubset[],
  targetCents: number,
  bankDayYmd: string | null,
  minSize: number,
  maxReturnResults: number,
  bankForName: ScoringBankRow | null = null,
): {
  combinations: string[][];
  maxCandidatesConsidered: number;
  totalEligible: number;
  nameMatch: 'per_line' | 'amount_only' | null;
} {
  if (!bankForName) {
    const core = findInternalRecordSubsetsForBankAmountCore(
      rows,
      targetCents,
      bankDayYmd,
      minSize,
      maxReturnResults,
    );
    return {
      ...core,
      nameMatch: null,
    };
  }

  const byId = rowById(rows);
  const nameOkRows = rows.filter(
    (r) => nameMatchBankVsInternalRow(bankForName, r) >= MIN_NAME_SCORE_CANDIDATE_LIST,
  );
  if (nameOkRows.length >= minSize) {
    const a = findInternalRecordSubsetsForBankAmountCore(
      nameOkRows,
      targetCents,
      bankDayYmd,
      minSize,
      maxReturnResults,
    );
    if (a.combinations.length > 0) {
      return {
        combinations: a.combinations,
        maxCandidatesConsidered: a.maxCandidatesConsidered,
        totalEligible: a.totalEligible,
        nameMatch: 'per_line',
      };
    }
  }

  const wide = findInternalRecordSubsetsForBankAmountCore(
    rows,
    targetCents,
    bankDayYmd,
    minSize,
    SUBSET_CANDIDATES_TO_INSPECT_FOR_NAME,
    SUBSET_CANDIDATES_TO_INSPECT_FOR_NAME,
  );
  const withName = filterCombosByMinName(
    bankForName,
    wide.combinations,
    byId,
    MIN_NAME_SCORE_CANDIDATE_LIST,
    maxReturnResults,
  );
  if (withName.length > 0) {
    return {
      combinations: withName,
      maxCandidatesConsidered: wide.maxCandidatesConsidered,
      totalEligible: wide.totalEligible,
      nameMatch: 'per_line',
    };
  }

  const finalCore = findInternalRecordSubsetsForBankAmountCore(
    rows,
    targetCents,
    bankDayYmd,
    minSize,
    maxReturnResults,
  );
  return {
    combinations: finalCore.combinations,
    maxCandidatesConsidered: finalCore.maxCandidatesConsidered,
    totalEligible: finalCore.totalEligible,
    nameMatch: finalCore.combinations.length > 0 ? 'amount_only' : null,
  };
}

/**
 * Candidatos a “só interno” (sem banco) — mesma base que
 * `getBankOnlyInternalSumCandidates` (poda do pool).
 */
export async function loadInternalOnlyPoolForSumHints(
  runId: string,
): Promise<PoolRow[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      amount: Prisma.Decimal;
      dueDate: Date | null;
      supplierNameRaw: string;
      supplierNameNorm: string | null;
    }[]
  >(Prisma.sql`
    SELECT DISTINCT ir.id, ir.amount, ir."dueDate", ir."supplierNameRaw", ir."supplierNameNorm"
    FROM "MatchSuggestion" ms
    INNER JOIN "SuggestionInternalLink" sil ON sil."suggestionId" = ms.id
    INNER JOIN "InternalRecord" ir ON ir.id = sil."internalRecordId"
    WHERE ms."runId" = ${runId}
      AND ms.status = 'OPEN'
      AND ms."triageBucket" = 'INTERNAL_ONLY'
      AND NOT EXISTS (
        SELECT 1 FROM "SuggestionBankLink" sbl WHERE sbl."suggestionId" = ms.id
      )
  `);
  return rows.map((ir) => ({
    id: ir.id,
    cents: moneyDecimalToCents(ir.amount),
    dueDate: ir.dueDate,
    supplierNameRaw: ir.supplierNameRaw,
    supplierNameNorm: ir.supplierNameNorm,
  }));
}

function toSubsetRows(p: PoolRow[]): RowForSubset[] {
  return p.map((x) => ({
    id: x.id,
    cents: x.cents,
    dueDate: x.dueDate,
    supplierNameRaw: x.supplierNameRaw,
    supplierNameNorm: x.supplierNameNorm,
  }));
}

/** Só banco: há soma com bate nome+valor (não basta só valor, para o ícone na lista). */
export function hasBankOnlyInternalAggregatedSum(
  bank: ScoringBankRow,
  internalPool: PoolRow[],
): boolean {
  const res = findInternalRecordSubsetsForBankAmount(
    toSubsetRows(internalPool),
    moneyDecimalToCents(bank.amount),
    isoDateOrNull(bank.dueDate),
    2,
    1,
    bank,
  );
  return res.combinations.length > 0 && res.nameMatch === 'per_line';
}

/**
 * Internos (só ERP) que entram em algum subconjunto com **nome+valor** coerente
 * a algum extrato (só banco) aberto.
 */
export function buildParticipatingInternalRecordIds(
  openBankOnlySuggestions: { bank: ScoringBankRow }[],
  internalPool: PoolRow[],
): Set<string> {
  const out = new Set<string>();
  for (const row of openBankOnlySuggestions) {
    const res = findInternalRecordSubsetsForBankAmount(
      toSubsetRows(internalPool),
      moneyDecimalToCents(row.bank.amount),
      isoDateOrNull(row.bank.dueDate),
      2,
      8,
      row.bank,
    );
    if (res.nameMatch !== 'per_line') {
      continue;
    }
    for (const g of res.combinations) {
      for (const id of g) {
        out.add(id);
      }
    }
  }
  return out;
}
