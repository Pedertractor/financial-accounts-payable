import { Prisma } from '../generated/prisma/client.js';
import {
  SuggestionReason,
  TriageBucket,
} from '../generated/prisma/enums.js';
import { normalizeCounterpartyName } from '../lib/name-normalize.js';

export type ScoringBankRow = {
  amount: Prisma.Decimal;
  dueDate: Date | null;
  beneficiaryNameRaw: string;
  beneficiaryNameNorm: string | null;
};

export type ScoringInternalRow = {
  amount: Prisma.Decimal;
  dueDate: Date | null;
  supplierNameRaw: string;
  supplierNameNorm: string | null;
};

function amountKey(d: Prisma.Decimal): string {
  return d.toString();
}

/** Mesmo “dia de calendário” em horário de Brasília. */
function dateKey(d: Date | null): string {
  if (!d) {
    return '—';
  }
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function matchKey(
  amount: Prisma.Decimal,
  due: Date | null,
): string {
  return `${amountKey(amount)}|${dateKey(due)}`;
}

function normName(
  n: string | null | undefined,
  raw: string,
): string {
  if (n && n.length > 0) {
    return n;
  }
  return normalizeCounterpartyName(raw);
}

export function nameMatchScore(
  bank: ScoringBankRow,
  internal: ScoringInternalRow,
): number {
  const a = normName(
    bank.beneficiaryNameNorm,
    bank.beneficiaryNameRaw,
  );
  const b = normName(
    internal.supplierNameNorm,
    internal.supplierNameRaw,
  );
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  if (a === b) {
    return 100;
  }
  if (a.includes(b) || b.includes(a)) {
    return 88;
  }
  const wa = a.split(' ').filter((w) => w.length > 2);
  const wb = b.split(' ').filter((w) => w.length > 2);
  if (wa.length === 0 || wb.length === 0) {
    return 0;
  }
  const setB = new Set(wb);
  const inter = wa.filter((w) => setB.has(w)).length;
  return Math.round(100 * (inter / Math.max(wa.length, wb.length, 1)));
}

/**
 * Piso mínimo de nota de nome (banco×ERP) para listar um candidato alternativo
 * no diálogo “vários candidatos”. Igual ao piso de `MANUAL_REVIEW_REQUIRED` no pareamento
 * — abaixo disso o nome considera “sem ligação” (ex.: 0% sem palavras em comum).
 * O pareamento **atual** (`isCurrent`) nunca é filtrado.
 */
export const MIN_NAME_SCORE_CANDIDATE_LIST = 25;

export function includeAsNamedCandidate(
  nameScore: number,
  isCurrent: boolean,
): boolean {
  return isCurrent || nameScore >= MIN_NAME_SCORE_CANDIDATE_LIST;
}

/** Mais de um interno (mesma chave valor+data) com nota de nome “plausível” para este banco. */
export function hasMultipleNamePlausiblePairingsForBank(
  bank: ScoringBankRow,
  internalsInSameKey: ScoringInternalRow[],
): boolean {
  const n = internalsInSameKey.filter(
    (ir) => nameMatchScore(bank, ir) >= MIN_NAME_SCORE_CANDIDATE_LIST,
  ).length;
  return n > 1;
}

export function namesAreStrictlyEqual(
  bank: ScoringBankRow,
  internal: ScoringInternalRow,
): boolean {
  const a = normName(
    bank.beneficiaryNameNorm,
    bank.beneficiaryNameRaw,
  );
  const b = normName(
    internal.supplierNameNorm,
    internal.supplierNameRaw,
  );
  return a.length > 0 && b.length > 0 && a === b;
}

export function computeFinalReason(
  nameScore: number,
  hadMultiple: boolean,
  exactNormalizedNames: boolean,
): SuggestionReason {
  if (hadMultiple) {
    return SuggestionReason.MULTIPLE_CANDIDATES;
  }
  if (exactNormalizedNames) {
    return SuggestionReason.EXACT_NAME_VALUE;
  }
  if (nameScore >= 55) {
    return SuggestionReason.FUZZY_NAME_MATCH;
  }
  if (nameScore >= 25) {
    return SuggestionReason.MANUAL_REVIEW_REQUIRED;
  }
  return SuggestionReason.VALUE_ONLY;
}

export function triageForMatchedName(nameScore: number): TriageBucket {
  if (nameScore >= 70) {
    return TriageBucket.PAY;
  }
  return TriageBucket.VERIFY;
}

/**
 * Recalcula triagem, motivo e notas a partir de um par banco × interno.
 * `internalsInSameKey`: quando informado, a ambiguidade de “vários candidatos” segue
 * a mesma regra do gerador (≥2 plausíveis por nome); caso contrário usa critério estrutural.
 */
export function recomputeMatchSuggestionFields(
  bank: ScoringBankRow,
  internal: ScoringInternalRow,
  keyStats: {
    nBanks: number;
    nInners: number;
    internalsInSameKey?: ScoringInternalRow[];
  },
): {
  triageBucket: TriageBucket;
  reason: SuggestionReason;
  scorePercent: number;
  nameScore: number;
  amountScore: number;
  dateScore: number;
  amountDifference: Prisma.Decimal | null;
} {
  const nameS = nameMatchScore(bank, internal);
  const strictEqual = namesAreStrictlyEqual(bank, internal);
  const hadMulti =
    keyStats.internalsInSameKey != null
      ? hasMultipleNamePlausiblePairingsForBank(
          bank,
          keyStats.internalsInSameKey,
        )
      : keyStats.nBanks > 1 || keyStats.nInners > 1;
  const reason = computeFinalReason(nameS, hadMulti, strictEqual);
  const diff = bank.amount.minus(internal.amount);
  const hasDiff = !diff.equals(0);
  const overall = Math.max(
    0,
    Math.min(100, Math.round((nameS + 100 + 100) / 3)),
  );
  return {
    triageBucket: triageForMatchedName(nameS),
    reason,
    scorePercent: overall,
    nameScore: nameS,
    amountScore: 100,
    dateScore: 100,
    amountDifference: hasDiff ? diff : null,
  };
}
