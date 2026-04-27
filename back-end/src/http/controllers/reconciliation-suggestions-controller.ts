import type { FastifyReply, FastifyRequest } from 'fastify';
import z from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import {
  PaymentVinculoKind,
  SuggestionReason,
  SuggestionStatus,
  TriageBucket,
} from '../../generated/prisma/enums.js';
import { HttpError } from '../erros/index.js';
import {
  includeAsNamedCandidate,
  matchKey,
  MIN_NAME_SCORE_CANDIDATE_LIST,
  nameMatchScore,
  recomputeMatchSuggestionFields,
} from '../../services/suggestion-pair-scoring.js';
import {
  buildParticipatingInternalRecordIds,
  findInternalRecordSubsetsForBankAmount,
  hasBankOnlyInternalAggregatedSum,
  loadInternalOnlyPoolForSumHints,
} from '../../services/aggregated-sum-hint.js';
import { normalizeCounterpartyName } from '../../lib/name-normalize.js';
import {
  paymentVinculoHasDetails,
  vinculoKindFromSuggestion,
} from '../../lib/payment-vinculo-helpers.js';
import { prisma } from '../../lib/prisma.js';

const paramsSchema = z.object({ runId: z.string().min(1) });

const querySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** Inclusivo; se omitido, usa só `date` (um dia). */
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(2000).optional(),
    statusFilter: z
      .enum(['todos', 'pendente', 'conferido', 'pago'])
      .optional()
      .default('todos'),
  })
  .refine(
    (q) => {
      if (q.endDate != null && q.date == null) {
        return false;
      }
      if (q.date != null && q.endDate != null && q.endDate < q.date) {
        return false;
      }
      return true;
    },
    { message: 'date/endDate inválidos' },
  );

const confirmParamsSchema = z.object({
  runId: z.string().min(1),
  suggestionId: z.string().min(1),
});

/** Só “Confirmar (A)” em exato, vários candidatos, ou motivos de revisão. */
export function isReasonConfirmable(reason: SuggestionReason): boolean {
  if (reason === SuggestionReason.EXACT_NAME_VALUE) {
    return true;
  }
  if (reason === SuggestionReason.MULTIPLE_CANDIDATES) {
    return true;
  }
  if (reason === SuggestionReason.PIX_CANDIDATE) {
    return true;
  }
  if (reason === SuggestionReason.TED_CANDIDATE) {
    return true;
  }
  return (
    reason === SuggestionReason.FUZZY_NAME_MATCH ||
    reason === SuggestionReason.MANUAL_REVIEW_REQUIRED ||
    reason === SuggestionReason.VALUE_ONLY
  );
}

/** [início, fim] inclusivos de calendário em America/Sao_Paulo. */
function saoPauloInclusiveYmdRange(
  fromYmd: string,
  toYmd: string,
): { gte: Date; lt: Date } {
  const gte = new Date(`${fromYmd}T00:00:00-03:00`);
  const toStart = new Date(`${toYmd}T00:00:00-03:00`);
  const lt = new Date(toStart.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}

/**
 * Resumo (total / pendente / conferido / pago) com os mesmos filtros de
 * `baseWhere` do Prisma, em uma passagem pelo banco (em vez de 4 counts).
 */
async function countMatchSuggestionSummary(
  runId: string,
  saoPauloDateRange: { gte: Date; lt: Date } | null,
): Promise<{
  total: number;
  pendente: number;
  conferido: number;
  pago: number;
}> {
  if (saoPauloDateRange) {
    const { gte, lt } = saoPauloDateRange;
    const rows = await prisma.$queryRaw<
      {
        total: bigint;
        pendente: bigint;
        conferido: bigint;
        pago: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE ms.status = 'OPEN')::bigint AS pendente,
        COUNT(*) FILTER (WHERE ms.status = 'APPROVED' AND ms."paidAt" IS NULL)::bigint AS conferido,
        COUNT(*) FILTER (WHERE ms."paidAt" IS NOT NULL)::bigint AS pago
      FROM "MatchSuggestion" ms
      WHERE ms."runId" = ${runId}
        AND ms.id IN (
          SELECT sbl."suggestionId"
          FROM "SuggestionBankLink" sbl
          INNER JOIN "BankRecord" br ON br.id = sbl."bankRecordId"
          WHERE
            br."runId" = ${runId}
            AND br."dueDate" IS NOT NULL
            AND br."dueDate" >= ${gte}
            AND br."dueDate" < ${lt}
          UNION
          SELECT sil."suggestionId"
          FROM "SuggestionInternalLink" sil
          INNER JOIN "InternalRecord" ir ON ir.id = sil."internalRecordId"
          WHERE
            ir."runId" = ${runId}
            AND ir."dueDate" IS NOT NULL
            AND ir."dueDate" >= ${gte}
            AND ir."dueDate" < ${lt}
        )
    `);
    const r = rows[0]!;
    return {
      total: Number(r.total),
      pendente: Number(r.pendente),
      conferido: Number(r.conferido),
      pago: Number(r.pago),
    };
  }
  const rows = await prisma.$queryRaw<
    {
      total: bigint;
      pendente: bigint;
      conferido: bigint;
      pago: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE ms.status = 'OPEN')::bigint AS pendente,
      COUNT(*) FILTER (WHERE ms.status = 'APPROVED' AND ms."paidAt" IS NULL)::bigint AS conferido,
      COUNT(*) FILTER (WHERE ms."paidAt" IS NOT NULL)::bigint AS pago
    FROM "MatchSuggestion" ms
    WHERE ms."runId" = ${runId}
  `);
  const r = rows[0]!;
  return {
    total: Number(r.total),
    pendente: Number(r.pendente),
    conferido: Number(r.conferido),
    pago: Number(r.pago),
  };
}

function decimalStr(v: Prisma.Decimal | null | undefined): string | null {
  if (v == null) {
    return null;
  }
  return v.toString();
}

function isoDateOrNull(d: Date | null): string | null {
  if (!d) {
    return null;
  }
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export async function listRunSuggestions(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { runId } = paramsSchema.parse(request.params);
  const query = querySchema.parse(request.query);

  const run = await prisma.reconciliationRun.findUnique({
    where: { id: runId },
    select: { id: true, title: true, status: true, unit: true },
  });
  if (!run) {
    throw new HttpError('Execução de conciliação não encontrada', 404);
  }

  const dateWhere: Prisma.MatchSuggestionWhereInput | undefined = query.date
    ? (() => {
        const toY = query.endDate ?? query.date!;
        const { gte, lt } = saoPauloInclusiveYmdRange(query.date, toY);
        return {
          OR: [
            {
              bankLinks: {
                some: {
                  bankRecord: { dueDate: { gte, lt } },
                },
              },
            },
            {
              internalLinks: {
                some: {
                  internalRecord: { dueDate: { gte, lt } },
                },
              },
            },
          ],
        };
      })()
    : undefined;

  const baseWhere: Prisma.MatchSuggestionWhereInput = {
    runId,
    ...dateWhere,
  };

  const take = query.limit ?? 1000;

  const listWhere: Prisma.MatchSuggestionWhereInput = { ...baseWhere };
  if (query.statusFilter === 'pendente') {
    listWhere.status = SuggestionStatus.OPEN;
  } else if (query.statusFilter === 'conferido') {
    listWhere.status = SuggestionStatus.APPROVED;
    listWhere.paidAt = null;
  } else if (query.statusFilter === 'pago') {
    listWhere.paidAt = { not: null };
  }

  const saoPauloDateRange = query.date
    ? (() => {
        const toY = query.endDate ?? query.date!;
        return saoPauloInclusiveYmdRange(query.date, toY);
      })()
    : null;

  const [summary, suggestions] = await Promise.all([
    countMatchSuggestionSummary(runId, saoPauloDateRange),
    prisma.matchSuggestion.findMany({
      where: listWhere,
      take,
      orderBy: [
        { triageBucket: 'asc' },
        { status: 'asc' },
        { scorePercent: 'desc' },
      ],
      include: {
        bankLinks: {
          include: {
            bankRecord: {
              select: {
                id: true,
                beneficiaryNameRaw: true,
                beneficiaryNameNorm: true,
                amount: true,
                dueDate: true,
                nossoNumero: true,
              },
            },
          },
        },
        internalLinks: {
          include: {
            internalRecord: {
              select: {
                id: true,
                supplierNameRaw: true,
                amount: true,
                dueDate: true,
                invoiceNumber: true,
              },
            },
          },
        },
      },
    }),
  ]);
  const { total, pendente, conferido, pago } = summary;

  const revisaoCategoria: ReadonlySet<string> = new Set([
    SuggestionReason.FUZZY_NAME_MATCH,
    SuggestionReason.MANUAL_REVIEW_REQUIRED,
    SuggestionReason.VALUE_ONLY,
  ]);

  const vinculoKeySeen = new Set<string>();
  const vinculoOr: Prisma.PaymentVinculoNameWhereInput[] = [];
  for (const s of suggestions) {
    const inners = s.internalLinks.map((l) => l.internalRecord);
    const vk = vinculoKindFromSuggestion({
      paymentVinculoKind: s.paymentVinculoKind,
      reason: s.reason,
    });
    if (!vk || !inners[0]) {
      continue;
    }
    const norm = normalizeCounterpartyName(inners[0].supplierNameRaw);
    if (!norm) {
      continue;
    }
    const key = `${norm}\t${vk}`;
    if (vinculoKeySeen.has(key)) {
      continue;
    }
    vinculoKeySeen.add(key);
    vinculoOr.push({
      AND: [{ normalizedName: norm }, { kind: vk }],
    });
  }

  /** Só banco, pendente: precisa do pool p/ dicas de soma e `participatingInternalRecordIds`. */
  const openBankOnlyForAggregatedSum = suggestions.filter(
    (s) =>
      s.status === SuggestionStatus.OPEN &&
      s.reason === SuggestionReason.NO_INTERNAL_MATCH &&
      s.bankLinks[0]?.bankRecord != null,
  );
  const needsInternalPoolForSum = openBankOnlyForAggregatedSum.length > 0;
  const [vinculoRows, internalPoolForSum] = await Promise.all([
    vinculoOr.length === 0
      ? Promise.resolve(
          [] as Awaited<
            ReturnType<
              typeof prisma.paymentVinculoName.findMany<{
                select: {
                  id: true
                  kind: true
                  normalizedName: true
                  pixChave: true
                  tedBanco: true
                  tedAgencia: true
                  tedConta: true
                  tedCnpj: true
                }
              }>
            >
          >,
        )
      : prisma.paymentVinculoName.findMany({
          where: { OR: vinculoOr },
          select: {
            id: true,
            kind: true,
            normalizedName: true,
            pixChave: true,
            tedBanco: true,
            tedAgencia: true,
            tedConta: true,
            tedCnpj: true,
          },
        }),
    needsInternalPoolForSum
      ? loadInternalOnlyPoolForSumHints(runId)
      : Promise.resolve<Awaited<ReturnType<typeof loadInternalOnlyPoolForSumHints>>>([]),
  ]);
  const vinculoByNormKind = new Map(
    vinculoRows.map((r) => [
      `${r.normalizedName}\t${r.kind}`,
      { id: r.id, hasDetails: paymentVinculoHasDetails(r) },
    ]),
  );

  const participatingInternalRecordIds = buildParticipatingInternalRecordIds(
    openBankOnlyForAggregatedSum.map((s) => ({
      bank: s.bankLinks[0]!.bankRecord,
    })),
    internalPoolForSum,
  );

  const bankOnlySumHintByBankId = new Map<string, boolean>();
  for (const s of openBankOnlyForAggregatedSum) {
    const b = s.bankLinks[0]!.bankRecord;
    if (bankOnlySumHintByBankId.has(b.id)) {
      continue;
    }
    bankOnlySumHintByBankId.set(
      b.id,
      hasBankOnlyInternalAggregatedSum(
        {
          amount: b.amount,
          dueDate: b.dueDate,
          beneficiaryNameRaw: b.beneficiaryNameRaw,
          beneficiaryNameNorm: b.beneficiaryNameNorm,
        },
        internalPoolForSum,
      ),
    );
  }

  const items = suggestions.map((s) => {
    const banks = s.bankLinks.map((l) => l.bankRecord);
    const inners = s.internalLinks.map((l) => l.internalRecord);

    const extLabel = banks
      .map((b) => b.beneficiaryNameRaw)
      .filter(Boolean)
      .join(' · ') || '—';
    const intLabel = inners
      .map((i) => i.supplierNameRaw)
      .filter(Boolean)
      .join(' · ') || '—';

    const bankAmt = banks[0] ? decimalStr(banks[0].amount) : null;
    const intAmt = (() => {
      if (inners.length === 0) {
        return null;
      }
      if (inners.length === 1) {
        return decimalStr(inners[0]!.amount);
      }
      const sum = inners.reduce(
        (acc, r) => acc.add(r.amount),
        new Prisma.Decimal(0),
      );
      return decimalStr(sum);
    })();
    const amount = bankAmt ?? intAmt;
    const dueForCompare =
      isoDateOrNull(banks[0]?.dueDate ?? null) ??
      isoDateOrNull(inners[0]?.dueDate ?? null);

    const vk = vinculoKindFromSuggestion({
      paymentVinculoKind: s.paymentVinculoKind,
      reason: s.reason,
    });
    let vinculoRegistry: { id: string; hasDetails: boolean } | null = null;
    if (vk && inners[0]) {
      const norm = normalizeCounterpartyName(inners[0].supplierNameRaw);
      if (norm) {
        vinculoRegistry = vinculoByNormKind.get(`${norm}\t${vk}`) ?? null;
      }
    }

    let sumAggregationAvailable = false;
    if (s.status === SuggestionStatus.OPEN) {
      if (s.reason === SuggestionReason.NO_INTERNAL_MATCH) {
        const b0 = banks[0];
        if (b0) {
          sumAggregationAvailable =
            bankOnlySumHintByBankId.get(b0.id) ?? false;
        }
      } else if (s.reason === SuggestionReason.NO_BANK_MATCH) {
        const i0 = inners[0];
        if (i0) {
          sumAggregationAvailable = participatingInternalRecordIds.has(
            i0.id,
          );
        }
      }
    }

    return {
      id: s.id,
      triageBucket: s.triageBucket,
      suggestionStatus: s.status,
      /** Quando foi conferida (APPROVED); nulo se pendente. */
      confirmedAt: s.confirmedAt ? s.confirmedAt.toISOString() : null,
      canConfirm: isReasonConfirmable(s.reason),
      paymentVinculoKind: s.paymentVinculoKind,
      reason: s.reason,
      reasonCategory: revisaoCategoria.has(s.reason) ? 'revisao' : 'padrao',
      scorePercent: s.scorePercent,
      amountDifference: decimalStr(s.amountDifference),
      explanation: s.explanation,
      amount,
      amountBank: bankAmt,
      amountInternal: intAmt,
      dueDate: dueForCompare,
      bankRecordIds: banks.map((b) => b.id),
      internalRecordIds: inners.map((i) => i.id),
      externalName: extLabel,
      internalName: intLabel,
      vinculoRegistry,
      /** Quando o financeiro marcou a conta como paga. */
      paidAt: s.paidAt ? s.paidAt.toISOString() : null,
      /** 2+ lançamentos do outro lado (triagem) podem somar a este valor (banco↔ERP). */
      sumAggregationAvailable,
      aggregatedErpLines:
        s.reason === SuggestionReason.AGGREGATED_CANDIDATE && inners.length > 0
          ? inners.map((i) => ({
              id: i.id,
              supplierNameRaw: i.supplierNameRaw,
              amount: decimalStr(i.amount) ?? '0',
              dueDate: i.dueDate ? i.dueDate.toISOString() : null,
              invoiceNumber: i.invoiceNumber,
            }))
          : undefined,
    };
  });

  return reply.status(200).send({
    run,
    filter: {
      compareDate: query.date ?? null,
      compareEndDate: query.endDate ?? query.date ?? null,
      statusFilter: query.statusFilter,
    },
    summary: {
      total,
      pendente,
      conferido,
      pago,
    },
    limit: take,
    items,
  });
}

const confirmBatchBody = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(500)
    .transform((arr) => [...new Set(arr)]),
});

export async function confirmSuggestionsBatch(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { runId } = paramsSchema.parse(request.params);
  const { ids } = confirmBatchBody.parse(request.body);
  const userId = (request as FastifyRequest & { user: { sub: string } }).user
    .sub;

  const found = await prisma.matchSuggestion.findMany({
    where: { runId, id: { in: ids } },
  });
  if (found.length !== ids.length) {
    throw new HttpError(
      'Uma ou mais sugestões não existem ou não pertencem a esta execução.',
      400,
    );
  }
  const eligible = found.filter(
    (s) =>
      s.status === SuggestionStatus.OPEN && isReasonConfirmable(s.reason),
  );
  if (eligible.length === 0) {
    throw new HttpError(
      'Nenhuma das selecionadas está pendente e elegível para confirmação (exato, vários candidatos, sugestão PIX/TED ou revisão).',
      400,
    );
  }
  const now = new Date();
  await prisma.$transaction(
    eligible.map((s) => {
      const toPaymentVinculo =
        s.reason === SuggestionReason.PIX_CANDIDATE
          ? {
              reason: SuggestionReason.PIX_VINCULO_OK,
              paymentVinculoKind: PaymentVinculoKind.PIX,
            }
          : s.reason === SuggestionReason.TED_CANDIDATE
            ? {
                reason: SuggestionReason.TED_VINCULO_OK,
                paymentVinculoKind: PaymentVinculoKind.TED,
              }
            : {};
      return prisma.matchSuggestion.update({
        where: { id: s.id },
        data: {
          status: SuggestionStatus.APPROVED,
          reviewedById: userId,
          confirmedAt: now,
          ...toPaymentVinculo,
        },
      });
    }),
  );
  const skipped = ids.length - eligible.length;
  return reply.status(200).send({
    confirmed: eligible.length,
    skipped,
  });
}

export async function confirmSuggestion(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { runId, suggestionId } = confirmParamsSchema.parse(
    request.params,
  );
  const userId = (request as FastifyRequest & { user: { sub: string } }).user
    .sub;

  const s = await prisma.matchSuggestion.findFirst({
    where: { id: suggestionId, runId },
  });
  if (!s) {
    throw new HttpError('Sugestão não encontrada', 404);
  }
  if (s.status !== SuggestionStatus.OPEN) {
    throw new HttpError('Esta sugestão já foi processada (não está pendente).', 400);
  }
  if (!isReasonConfirmable(s.reason)) {
    throw new HttpError(
      'Só é possível confirmar sugestões com nome/valor exatos, vários candidatos, sugestão PIX/TED, ou em revisão (aproximado, manual, só valor).',
      400,
    );
  }
  const now = new Date();
  const toPaymentVinculo =
    s.reason === SuggestionReason.PIX_CANDIDATE
      ? {
          reason: SuggestionReason.PIX_VINCULO_OK,
          paymentVinculoKind: PaymentVinculoKind.PIX,
        }
      : s.reason === SuggestionReason.TED_CANDIDATE
        ? {
            reason: SuggestionReason.TED_VINCULO_OK,
            paymentVinculoKind: PaymentVinculoKind.TED,
          }
        : {};
  const updated = await prisma.matchSuggestion.update({
    where: { id: suggestionId },
    data: {
      status: SuggestionStatus.APPROVED,
      reviewedById: userId,
      confirmedAt: now,
      ...toPaymentVinculo,
    },
  });
  return reply.status(200).send({
    suggestion: {
      id: updated.id,
      status: updated.status,
      confirmedAt: updated.confirmedAt?.toISOString() ?? null,
    },
  });
}

const linkPaymentBody = z.object({
  kind: z.enum(['PIX', 'TED']),
});

/**
 * Aprovar “sem par no banco” como OK via PIX ou TED e registrar o fornecedor.
 */
export async function linkPaymentVinculo(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { runId, suggestionId } = confirmParamsSchema.parse(request.params);
  const { kind } = linkPaymentBody.parse(request.body ?? {});
  const userId = (request as FastifyRequest & { user: { sub: string } }).user
    .sub;

  const vKind =
    kind === 'PIX' ? PaymentVinculoKind.PIX : PaymentVinculoKind.TED;
  const reasonOk =
    vKind === PaymentVinculoKind.PIX
      ? SuggestionReason.PIX_VINCULO_OK
      : SuggestionReason.TED_VINCULO_OK;

  const s = await prisma.matchSuggestion.findFirst({
    where: { id: suggestionId, runId },
    include: {
      bankLinks: { take: 1 },
      internalLinks: { include: { internalRecord: true } },
    },
  });
  if (!s) {
    throw new HttpError('Sugestão não encontrada', 404);
  }
  if (s.status !== SuggestionStatus.OPEN) {
    throw new HttpError('Esta sugestão não está pendente.', 400);
  }
  if (s.reason !== SuggestionReason.NO_BANK_MATCH) {
    throw new HttpError(
      'O vínculo só se aplica a itens com motivo “sem par banco” (só interno, sem movimento bancário).',
      400,
    );
  }
  if (s.bankLinks.length > 0 || s.internalLinks.length === 0) {
    throw new HttpError('Esta sugestão não é apenas interna (só par ERP).', 400);
  }
  const int0 = s.internalLinks[0]!.internalRecord;
  const norm = normalizeCounterpartyName(int0.supplierNameRaw);
  if (norm.length === 0) {
    throw new HttpError('Não foi possível normalizar o nome do fornecedor.', 400);
  }
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await tx.paymentVinculoName.upsert({
      where: {
        normalizedName_kind: { normalizedName: norm, kind: vKind },
      },
      create: {
        displayName: int0.supplierNameRaw,
        normalizedName: norm,
        kind: vKind,
        createdById: userId,
      },
      update: {
        displayName: int0.supplierNameRaw,
      },
    });
    return tx.matchSuggestion.update({
      where: { id: s.id },
      data: {
        status: SuggestionStatus.APPROVED,
        reason: reasonOk,
        paymentVinculoKind: vKind,
        reviewedById: userId,
        confirmedAt: now,
      },
    });
  });
  return reply.status(200).send({
    suggestion: {
      id: result.id,
      status: result.status,
      confirmedAt: result.confirmedAt?.toISOString() ?? null,
    },
  });
}

/**
 * Marca sugestão OK (APPROVED) como paga; persiste `paidAt` e `paidById`.
 */
export async function markSuggestionPaid(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { runId, suggestionId } = confirmParamsSchema.parse(
    request.params,
  );
  const userId = (request as FastifyRequest & { user: { sub: string } }).user
    .sub;

  const s = await prisma.matchSuggestion.findFirst({
    where: { id: suggestionId, runId },
  });
  if (!s) {
    throw new HttpError('Sugestão não encontrada', 404);
  }
  if (s.status !== SuggestionStatus.APPROVED) {
    throw new HttpError(
      'Só é possível marcar como paga uma sugestão já conferida (status conferido).',
      400,
    );
  }
  if (s.paidAt) {
    return reply.status(200).send({
      suggestion: {
        id: s.id,
        status: s.status,
        paidAt: s.paidAt.toISOString(),
      },
    });
  }
  const updated = await prisma.matchSuggestion.update({
    where: { id: suggestionId },
    data: {
      paidAt: new Date(),
      paidById: userId,
    },
  });
  return reply.status(200).send({
    suggestion: {
      id: updated.id,
      status: updated.status,
      paidAt: updated.paidAt?.toISOString() ?? null,
    },
  });
}

const resolveCandidateBody = z.object({
  internalRecordId: z.string().min(1),
  bankRecordId: z.string().min(1),
});

const bankSelect = {
  id: true,
  amount: true,
  dueDate: true,
  beneficiaryNameRaw: true,
  beneficiaryNameNorm: true,
} as const;

const internalSelect = {
  id: true,
  amount: true,
  dueDate: true,
  supplierNameRaw: true,
  supplierNameNorm: true,
  invoiceNumber: true,
} as const;

async function loadKeyAmbiguityForBank(
  runId: string,
  bank: { amount: Prisma.Decimal; dueDate: Date | null },
) {
  const k = matchKey(bank.amount, bank.dueDate);
  const [allBanksSameAmt, allInnersSameAmt] = await Promise.all([
    prisma.bankRecord.findMany({ where: { runId, amount: bank.amount } }),
    prisma.internalRecord.findMany({ where: { runId, amount: bank.amount } }),
  ]);
  const nBanks = allBanksSameAmt.filter(
    (b) => matchKey(b.amount, b.dueDate) === k,
  ).length;
  const nInners = allInnersSameAmt.filter(
    (i) => matchKey(i.amount, i.dueDate) === k,
  ).length;
  return { nBanks, nInners, matchKey: k };
}

type DbLike = { internalRecord: { findMany: (args: object) => Promise<{
  amount: Prisma.Decimal
  dueDate: Date | null
  supplierNameRaw: string
  supplierNameNorm: string | null
}[]> } };

async function listScoringInternalsInKey(
  runId: string,
  matchK: string,
  bank: { amount: Prisma.Decimal; dueDate: Date | null },
  db: DbLike,
) {
  const inners = await db.internalRecord.findMany({
    where: { runId, amount: bank.amount },
  });
  return inners
    .filter((i) => matchKey(i.amount, i.dueDate) === matchK)
    .map((i) => ({
      amount: i.amount,
      dueDate: i.dueDate,
      supplierNameRaw: i.supplierNameRaw,
      supplierNameNorm: i.supplierNameNorm,
    }));
}

/** Lista internos com mesmo valor+vencimento (dia SP) do banco desta sugestão, para `MULTIPLE_CANDIDATES`. */
export async function getSuggestionMultipleCandidates(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { runId, suggestionId } = confirmParamsSchema.parse(request.params);
  const s = await prisma.matchSuggestion.findFirst({
    where: { id: suggestionId, runId },
    include: {
      bankLinks: { include: { bankRecord: { select: bankSelect } } },
      internalLinks: { include: { internalRecord: { select: internalSelect } } },
    },
  });
  if (!s) {
    throw new HttpError('Sugestão não encontrada', 404);
  }
  if (s.reason !== SuggestionReason.MULTIPLE_CANDIDATES) {
    return reply.status(200).send({
      applicable: false,
      matchKey: null,
      nBanks: 0,
      nInternals: 0,
      currentInternalRecordId: null as string | null,
      currentBankRecordId: null as string | null,
      bankRecordId: null as string | null,
      bankCandidates: [] as unknown[],
      internalCandidates: [] as unknown[],
    });
  }
  const bank = s.bankLinks[0]?.bankRecord;
  if (!bank) {
    throw new HttpError('Sugestão sem lançamento bancário', 400);
  }
  const int0 = s.internalLinks[0]?.internalRecord;
  if (!int0) {
    throw new HttpError('Sugestão sem lançamento interno', 400);
  }
  const { nBanks, nInners, matchKey: k } = await loadKeyAmbiguityForBank(
    runId,
    bank,
  );
  const [allBanksSameAmt, allInnersSameAmt] = await Promise.all([
    prisma.bankRecord.findMany({ where: { runId, amount: bank.amount } }),
    prisma.internalRecord.findMany({ where: { runId, amount: bank.amount } }),
  ]);
  const banksInKey = allBanksSameAmt.filter(
    (b) => matchKey(b.amount, b.dueDate) === k,
  );
  const innersInKey = allInnersSameAmt.filter(
    (i) => matchKey(i.amount, i.dueDate) === k,
  );
  const currentIntId = int0.id;
  const currentBankId = bank.id;
  const iScore = {
    amount: int0.amount,
    dueDate: int0.dueDate,
    supplierNameRaw: int0.supplierNameRaw,
    supplierNameNorm: int0.supplierNameNorm,
  };
  const bScore = {
    amount: bank.amount,
    dueDate: bank.dueDate,
    beneficiaryNameRaw: bank.beneficiaryNameRaw,
    beneficiaryNameNorm: bank.beneficiaryNameNorm,
  };
  const bankCandidates = await Promise.all(
    banksInKey.map(async (br) => {
      const who = await prisma.suggestionBankLink.findFirst({
        where: {
          bankRecordId: br.id,
          suggestion: { runId },
        },
        include: { suggestion: { select: { id: true, status: true } } },
      });
      return {
        id: br.id,
        beneficiaryNameRaw: br.beneficiaryNameRaw,
        amount: br.amount.toString(),
        dueDate: br.dueDate ? br.dueDate.toISOString() : null,
        nameScore: nameMatchScore(
          {
            amount: br.amount,
            dueDate: br.dueDate,
            beneficiaryNameRaw: br.beneficiaryNameRaw,
            beneficiaryNameNorm: br.beneficiaryNameNorm,
          },
          iScore,
        ),
        isCurrent: currentBankId === br.id,
        pairedSuggestionId: who?.suggestionId ?? null,
        pairedStatus: who?.suggestion?.status ?? null,
      };
    }),
  );
  const internalCandidates = await Promise.all(
    innersInKey.map(async (ir) => {
      const who = await prisma.suggestionInternalLink.findFirst({
        where: {
          internalRecordId: ir.id,
          suggestion: { runId },
        },
        include: { suggestion: { select: { id: true, status: true } } },
      });
      return {
        id: ir.id,
        supplierNameRaw: ir.supplierNameRaw,
        amount: ir.amount.toString(),
        dueDate: ir.dueDate ? ir.dueDate.toISOString() : null,
        invoiceNumber: ir.invoiceNumber,
        nameScore: nameMatchScore(
          bScore,
          {
            amount: ir.amount,
            dueDate: ir.dueDate,
            supplierNameRaw: ir.supplierNameRaw,
            supplierNameNorm: ir.supplierNameNorm,
          },
        ),
        isCurrent: currentIntId === ir.id,
        pairedSuggestionId: who?.suggestionId ?? null,
        pairedStatus: who?.suggestion?.status ?? null,
      };
    }),
  );
  internalCandidates.sort((a, b) => b.nameScore - a.nameScore);
  bankCandidates.sort((a, b) => b.nameScore - a.nameScore);

  const bankVisible = bankCandidates.filter((r) =>
    includeAsNamedCandidate(r.nameScore, r.isCurrent),
  );
  const internalVisible = internalCandidates.filter((r) =>
    includeAsNamedCandidate(r.nameScore, r.isCurrent),
  );
  const excludedBanks = bankCandidates.length - bankVisible.length;
  const excludedInternals = internalCandidates.length - internalVisible.length;

  return reply.status(200).send({
    applicable: true,
    matchKey: k,
    nBanks,
    nInternals: nInners,
    currentInternalRecordId: currentIntId,
    currentBankRecordId: currentBankId,
    bankRecordId: bank.id,
    minNameScoreCandidateList: MIN_NAME_SCORE_CANDIDATE_LIST,
    excludedLowNameSimilarity: {
      bankRows: excludedBanks,
      internalRows: excludedInternals,
    },
    bankCandidates: bankVisible,
    /** @deprecated use internalCandidates; mantido para clientes antigos. */
    candidates: internalVisible,
    internalCandidates: internalVisible,
  });
}

async function recomputeAndSaveOpenSuggestion(
  tx: Prisma.TransactionClient,
  id: string,
  keyMeta: { nBanks: number; nInners: number; matchKey: string },
  runId: string,
) {
  const s2 = await tx.matchSuggestion.findUniqueOrThrow({
    where: { id },
    include: {
      bankLinks: { include: { bankRecord: { select: bankSelect } } },
      internalLinks: { include: { internalRecord: { select: internalSelect } } },
    },
  });
  if (
    s2.status !== SuggestionStatus.OPEN
    || !s2.bankLinks[0]
    || !s2.internalLinks[0]
  ) {
    return;
  }
  const b2 = s2.bankLinks[0].bankRecord;
  const i2 = s2.internalLinks[0].internalRecord;
  const internalsInKey = await listScoringInternalsInKey(
    runId,
    keyMeta.matchKey,
    b2,
    tx,
  );
  const fieldsB = recomputeMatchSuggestionFields(
    {
      amount: b2.amount,
      dueDate: b2.dueDate,
      beneficiaryNameRaw: b2.beneficiaryNameRaw,
      beneficiaryNameNorm: b2.beneficiaryNameNorm,
    },
    {
      amount: i2.amount,
      dueDate: i2.dueDate,
      supplierNameRaw: i2.supplierNameRaw,
      supplierNameNorm: i2.supplierNameNorm,
    },
    {
      nBanks: keyMeta.nBanks,
      nInners: keyMeta.nInners,
      internalsInSameKey: internalsInKey,
    },
  );
  await tx.matchSuggestion.update({
    where: { id: s2.id },
    data: {
      triageBucket: fieldsB.triageBucket,
      reason: fieldsB.reason,
      scorePercent: fieldsB.scorePercent,
      nameScore: fieldsB.nameScore,
      amountScore: fieldsB.amountScore,
      dateScore: fieldsB.dateScore,
      amountDifference: fieldsB.amountDifference,
    },
  });
}

/**
 * Vincula banco e interno escolhidos (trocas com outras sugestões abertas, mesmo valor+dia) e aprova.
 */
export async function resolveMultipleCandidateAndConfirm(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { runId, suggestionId } = confirmParamsSchema.parse(request.params);
  const { internalRecordId: I_n, bankRecordId: B_n } = resolveCandidateBody.parse(
    request.body,
  );
  const userId = (request as FastifyRequest & { user: { sub: string } }).user
    .sub;

  const s0 = await prisma.matchSuggestion.findFirst({
    where: { id: suggestionId, runId, reason: SuggestionReason.MULTIPLE_CANDIDATES },
    include: {
      bankLinks: { include: { bankRecord: { select: bankSelect } } },
      internalLinks: { include: { internalRecord: { select: internalSelect } } },
    },
  });
  if (!s0) {
    throw new HttpError(
      'Sugestão não encontrada ou o motivo não é “vários candidatos”. Use a confirmação padrão.',
      404,
    );
  }
  if (s0.status !== SuggestionStatus.OPEN) {
    throw new HttpError('Esta sugestão já foi processada (não está pendente).', 400);
  }
  const bank0 = s0.bankLinks[0]?.bankRecord;
  const int0 = s0.internalLinks[0]?.internalRecord;
  if (!bank0 || !int0) {
    throw new HttpError('Sugestão sem lançamento bancário ou interno', 400);
  }
  const B_c = bank0.id;
  const I_c = int0.id;
  const keyMeta = await loadKeyAmbiguityForBank(runId, bank0);
  const [banksInKey, innersInKey] = [
    (await prisma.bankRecord.findMany({ where: { runId, amount: bank0.amount } })).filter(
      (b) => matchKey(b.amount, b.dueDate) === keyMeta.matchKey,
    ),
    (await prisma.internalRecord.findMany({ where: { runId, amount: bank0.amount } })).filter(
      (i) => matchKey(i.amount, i.dueDate) === keyMeta.matchKey,
    ),
  ];
  const validBank = new Set(banksInKey.map((b) => b.id));
  const validInt = new Set(innersInKey.map((i) => i.id));
  if (!validBank.has(B_n) || !validInt.has(I_n)) {
    throw new HttpError(
      'Banco ou fornecedor escolhido não pertencem ao mesmo grupo (valor e vencimento) desta triagem.',
      400,
    );
  }
  if (B_n === B_c && I_n === I_c) {
    const now = new Date();
    const updated = await prisma.matchSuggestion.update({
      where: { id: suggestionId },
      data: {
        status: SuggestionStatus.APPROVED,
        reviewedById: userId,
        confirmedAt: now,
      },
    });
    return reply.status(200).send({
      swapped: false,
      suggestion: {
        id: updated.id,
        status: updated.status,
        confirmedAt: updated.confirmedAt?.toISOString() ?? null,
      },
    });
  }

  const [conflI, conflB] = await Promise.all([
    prisma.suggestionInternalLink.findFirst({
      where: {
        internalRecordId: I_n,
        suggestionId: { not: suggestionId },
        suggestion: { runId },
      },
    }),
    prisma.suggestionBankLink.findFirst({
      where: {
        bankRecordId: B_n,
        suggestionId: { not: suggestionId },
        suggestion: { runId },
      },
    }),
  ]);
  const stI = conflI
    ? (await prisma.matchSuggestion.findFirst({ where: { id: conflI.suggestionId } }))
      ?.status
    : null;
  const stB = conflB
    ? (await prisma.matchSuggestion.findFirst({ where: { id: conflB.suggestionId } }))
      ?.status
    : null;
  if (stI === SuggestionStatus.APPROVED || stB === SuggestionStatus.APPROVED) {
    throw new HttpError(
      'O banco ou o fornecedor escolhido está vinculado a outra sugestão já confirmada. Recalcule a triagem se necessário.',
      409,
    );
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const toRecompute: string[] = [];
    const sFull = await tx.matchSuggestion.findFirst({
      where: {
        runId,
        id: { not: suggestionId },
        status: SuggestionStatus.OPEN,
        bankLinks: { some: { bankRecordId: B_n } },
        internalLinks: { some: { internalRecordId: I_n } },
      },
    });

    if (sFull) {
      const sA = await tx.matchSuggestion.findUniqueOrThrow({
        where: { id: suggestionId },
        include: { bankLinks: true, internalLinks: true },
      });
      const tA = await tx.matchSuggestion.findUniqueOrThrow({
        where: { id: sFull.id },
        include: { bankLinks: true, internalLinks: true },
      });
      if (!sA.bankLinks[0] || !sA.internalLinks[0] || !tA.bankLinks[0] || !tA.internalLinks[0]) {
        throw new HttpError('Links incompletos para trocar o par de sugestões.', 500);
      }
      const Bc = sA.bankLinks[0]!.bankRecordId;
      const Ic = sA.internalLinks[0]!.internalRecordId;
      const Bt = tA.bankLinks[0]!.bankRecordId;
      const It = tA.internalLinks[0]!.internalRecordId;
      await tx.suggestionBankLink.deleteMany({
        where: { id: { in: [sA.bankLinks[0]!.id, tA.bankLinks[0]!.id] } },
      });
      await tx.suggestionInternalLink.deleteMany({
        where: { id: { in: [sA.internalLinks[0]!.id, tA.internalLinks[0]!.id] } },
      });
      await tx.suggestionBankLink.createMany({
        data: [
          { suggestionId, bankRecordId: Bt },
          { suggestionId: tA.id, bankRecordId: Bc },
        ],
      });
      await tx.suggestionInternalLink.createMany({
        data: [
          { suggestionId, internalRecordId: It },
          { suggestionId: tA.id, internalRecordId: Ic },
        ],
      });
      toRecompute.push(suggestionId, tA.id);
    } else {
      const loadS = async () =>
        tx.matchSuggestion.findUniqueOrThrow({
          where: { id: suggestionId },
          include: { bankLinks: true, internalLinks: true },
        });
      const cur0 = await loadS();
      const curB = cur0.bankLinks[0]!.bankRecordId;
      const curI = cur0.internalLinks[0]!.internalRecordId;

      if (curB !== B_n) {
        const oBank = await tx.suggestionBankLink.findFirst({
          where: { bankRecordId: B_n, suggestionId: { not: suggestionId }, suggestion: { runId, status: SuggestionStatus.OPEN } },
        });
        if (oBank) {
          await tx.suggestionBankLink.deleteMany({
            where: { id: { in: [cur0.bankLinks[0]!.id, oBank.id] } },
          });
          await tx.suggestionBankLink.createMany({
            data: [
              { suggestionId, bankRecordId: B_n },
              { suggestionId: oBank.suggestionId, bankRecordId: curB },
            ],
          });
          toRecompute.push(suggestionId, oBank.suggestionId);
        } else {
          await tx.suggestionBankLink.delete({ where: { id: cur0.bankLinks[0]!.id } });
          await tx.suggestionBankLink.create({
            data: { suggestionId, bankRecordId: B_n },
          });
          toRecompute.push(suggestionId);
        }
      }
      const cur1 = await loadS();
      const cB = cur1.bankLinks[0]!.bankRecordId;
      const cI = cur1.internalLinks[0]!.internalRecordId;
      if (cI !== I_n) {
        const oIn = await tx.suggestionInternalLink.findFirst({
          where: { internalRecordId: I_n, suggestionId: { not: suggestionId }, suggestion: { runId, status: SuggestionStatus.OPEN } },
        });
        if (oIn) {
          await tx.suggestionInternalLink.deleteMany({
            where: { id: { in: [cur1.internalLinks[0]!.id, oIn.id] } },
          });
          await tx.suggestionInternalLink.createMany({
            data: [
              { suggestionId, internalRecordId: I_n },
              { suggestionId: oIn.suggestionId, internalRecordId: cI },
            ],
          });
          toRecompute.push(suggestionId, oIn.suggestionId);
        } else {
          await tx.suggestionInternalLink.delete({ where: { id: cur1.internalLinks[0]!.id } });
          await tx.suggestionInternalLink.create({
            data: { suggestionId, internalRecordId: I_n },
          });
          toRecompute.push(suggestionId);
        }
      }
    }
    for (const sid of new Set(toRecompute)) {
      if (sid !== suggestionId) {
        await recomputeAndSaveOpenSuggestion(tx, sid, keyMeta, runId);
      }
    }
    const sEnd = await tx.matchSuggestion.findUniqueOrThrow({
      where: { id: suggestionId },
      include: {
        bankLinks: { include: { bankRecord: { select: bankSelect } } },
        internalLinks: { include: { internalRecord: { select: internalSelect } } },
      },
    });
    const bF = sEnd.bankLinks[0]!.bankRecord;
    const iF = sEnd.internalLinks[0]!.internalRecord;
    if (bF.id !== B_n || iF.id !== I_n) {
      throw new HttpError('Não foi possível aplicar o banco e o fornecedor escolhidos.', 500);
    }
    const internalsInKeyA = await listScoringInternalsInKey(
      runId,
      keyMeta.matchKey,
      bF,
      tx,
    );
    const fieldsA = recomputeMatchSuggestionFields(
      {
        amount: bF.amount,
        dueDate: bF.dueDate,
        beneficiaryNameRaw: bF.beneficiaryNameRaw,
        beneficiaryNameNorm: bF.beneficiaryNameNorm,
      },
      {
        amount: iF.amount,
        dueDate: iF.dueDate,
        supplierNameRaw: iF.supplierNameRaw,
        supplierNameNorm: iF.supplierNameNorm,
      },
      {
        nBanks: keyMeta.nBanks,
        nInners: keyMeta.nInners,
        internalsInSameKey: internalsInKeyA,
      },
    );
    return tx.matchSuggestion.update({
      where: { id: suggestionId },
      data: {
        status: SuggestionStatus.APPROVED,
        reviewedById: userId,
        confirmedAt: now,
        triageBucket: fieldsA.triageBucket,
        reason: fieldsA.reason,
        scorePercent: fieldsA.scorePercent,
        nameScore: fieldsA.nameScore,
        amountScore: fieldsA.amountScore,
        dateScore: fieldsA.dateScore,
        amountDifference: fieldsA.amountDifference,
      },
    });
  });
  return reply.status(200).send({
    swapped: true,
    suggestion: {
      id: result.id,
      status: result.status,
      confirmedAt: result.confirmedAt?.toISOString() ?? null,
    },
  });
}

const bankOnlyInternalSumBody = z.object({
  /** Agregado com muitas parcelas (ex.: dezenas de títulos no extrato). */
  internalRecordIds: z.array(z.string().min(1)).min(2).max(500),
});

function moneyDecimalToCents(d: Prisma.Decimal): number {
  return parseInt(d.mul(100).round().toString(), 10);
}

/**
 * Soma de 2+ internos (sem par no banco) que batem no valor de um banco “só no extrato”.
 */
export async function getBankOnlyInternalSumCandidates(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { runId, suggestionId } = confirmParamsSchema.parse(request.params);
  const s = await prisma.matchSuggestion.findFirst({
    where: { id: suggestionId, runId, reason: SuggestionReason.NO_INTERNAL_MATCH },
    include: {
      bankLinks: { include: { bankRecord: { select: bankSelect } } },
      internalLinks: true,
    },
  });
  if (!s) {
    return reply.status(200).send({
      applicable: false,
      targetAmount: null as string | null,
      targetCents: null as number | null,
      bankRecord: null,
      bankRecordId: null as string | null,
      maxCandidatesConsidered: 0,
      manualPool: [] as unknown[],
      combinations: [] as unknown[],
    });
  }
  if (s.internalLinks.length > 0) {
    return reply.status(200).send({
      applicable: false,
      targetAmount: null,
      targetCents: null,
      bankRecord: null,
      bankRecordId: null,
      maxCandidatesConsidered: 0,
      manualPool: [],
      combinations: [],
    });
  }
  const bank = s.bankLinks[0]?.bankRecord;
  if (!bank) {
    throw new HttpError('Sugestão sem movimento bancário', 400);
  }
  const targetCents = moneyDecimalToCents(bank.amount);

  const internalOpen = await prisma.matchSuggestion.findMany({
    where: {
      runId,
      status: SuggestionStatus.OPEN,
      triageBucket: TriageBucket.INTERNAL_ONLY,
      bankLinks: { none: {} },
    },
    include: {
      internalLinks: { include: { internalRecord: { select: internalSelect } } },
    },
  });
  const pool: {
    id: string;
    suggestionId: string;
    amount: Prisma.Decimal;
    dueDate: Date | null;
    supplierNameRaw: string;
    supplierNameNorm: string | null;
  }[] = [];
  for (const ms of internalOpen) {
    for (const sl of ms.internalLinks) {
      if (!pool.some((p) => p.id === sl.internalRecordId)) {
        const ir = sl.internalRecord;
        pool.push({
          id: sl.internalRecordId,
          suggestionId: ms.id,
          amount: ir.amount,
          dueDate: ir.dueDate,
          supplierNameRaw: ir.supplierNameRaw,
          supplierNameNorm: ir.supplierNameNorm,
        });
      }
    }
  }
  const bankDay = isoDateOrNull(bank.dueDate);
  const bScore: {
    amount: Prisma.Decimal;
    dueDate: Date | null;
    beneficiaryNameRaw: string;
    beneficiaryNameNorm: string | null;
  } = {
    amount: bank.amount,
    dueDate: bank.dueDate,
    beneficiaryNameRaw: bank.beneficiaryNameRaw,
    beneficiaryNameNorm: bank.beneficiaryNameNorm,
  };
  const rows = pool.map((p) => ({
    id: p.id,
    cents: moneyDecimalToCents(p.amount),
    dueDate: p.dueDate,
    supplierNameRaw: p.supplierNameRaw,
    supplierNameNorm: p.supplierNameNorm,
  }));
  const {
    combinations: subsetIdLists,
    maxCandidatesConsidered,
    totalEligible,
    nameMatch: aggregatedNameMatch,
  } = findInternalRecordSubsetsForBankAmount(
    rows,
    targetCents,
    bankDay,
    2,
    3,
    bScore,
  );
  const manualPool = pool.map((p) => ({
    id: p.id,
    supplierNameRaw: p.supplierNameRaw,
    amount: p.amount.toString(),
    dueDate: p.dueDate ? p.dueDate.toISOString() : null,
    sourceSuggestionId: p.suggestionId,
  }));
  const canManualVincolo = manualPool.length >= 2;
  if (totalEligible < 2) {
    return reply.status(200).send({
      applicable: canManualVincolo,
      targetAmount: bank.amount.toString(),
      targetCents,
      bankRecord: {
        id: bank.id,
        beneficiaryNameRaw: bank.beneficiaryNameRaw,
        amount: bank.amount.toString(),
        dueDate: bank.dueDate ? bank.dueDate.toISOString() : null,
      },
      bankRecordId: bank.id,
      maxCandidatesConsidered,
      totalEligible,
      nameMatch: null,
      manualPool,
      combinations: [] as unknown[],
    });
  }
  if (subsetIdLists.length === 0) {
    return reply.status(200).send({
      applicable: canManualVincolo,
      targetAmount: bank.amount.toString(),
      targetCents,
      bankRecord: {
        id: bank.id,
        beneficiaryNameRaw: bank.beneficiaryNameRaw,
        amount: bank.amount.toString(),
        dueDate: bank.dueDate ? bank.dueDate.toISOString() : null,
      },
      bankRecordId: bank.id,
      maxCandidatesConsidered,
      totalEligible,
      nameMatch: null,
      manualPool,
      combinations: [] as unknown[],
    });
  }
  const byIntId = new Map(
    pool.map(
      (p) =>
        [
          p.id,
          {
            id: p.id,
            suggestionId: p.suggestionId,
            cents: moneyDecimalToCents(p.amount),
          },
        ] as const,
    ),
  );
  const combinations = await Promise.all(
    subsetIdLists.map(async (ids) => {
      const rows = await Promise.all(
        ids.map((id) =>
          prisma.internalRecord.findUniqueOrThrow({ where: { id } }),
        ),
      );
      const nameScores = rows.map((r) =>
        nameMatchScore(bScore, {
          amount: r.amount,
          dueDate: r.dueDate,
          supplierNameRaw: r.supplierNameRaw,
          supplierNameNorm: r.supplierNameNorm,
        }),
      );
      const nameScore = Math.round(
        nameScores.reduce((a, b) => a + b, 0) / nameScores.length,
      );
      return {
        internalRecordIds: ids,
        avgNameScore: nameScore,
        internals: rows.map((r) => ({
          id: r.id,
          supplierNameRaw: r.supplierNameRaw,
          amount: r.amount.toString(),
          dueDate: r.dueDate ? r.dueDate.toISOString() : null,
          invoiceNumber: r.invoiceNumber,
          nameScore: nameMatchScore(bScore, {
            amount: r.amount,
            dueDate: r.dueDate,
            supplierNameRaw: r.supplierNameRaw,
            supplierNameNorm: r.supplierNameNorm,
          }),
          sourceSuggestionId: byIntId.get(r.id)!.suggestionId,
        })),
      };
    }),
  );
  return reply.status(200).send({
    applicable: true,
    targetAmount: bank.amount.toString(),
    targetCents,
    maxCandidatesConsidered,
    totalEligible,
    nameMatch: aggregatedNameMatch,
    bankRecordId: bank.id,
    bankRecord: {
      id: bank.id,
      beneficiaryNameRaw: bank.beneficiaryNameRaw,
      amount: bank.amount.toString(),
      dueDate: bank.dueDate ? bank.dueDate.toISOString() : null,
    },
    manualPool,
    combinations,
  });
}

/**
 * Vincula o banco a vários internos, remove sugestões “só interno” e aprova como agregado.
 */
export async function resolveBankOnlyInternalSum(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { runId, suggestionId } = confirmParamsSchema.parse(request.params);
  const { internalRecordIds: rawIds } = bankOnlyInternalSumBody.parse(
    request.body,
  );
  const internalRecordIds = [...new Set(rawIds)];
  if (internalRecordIds.length < 2) {
    throw new HttpError('Informe ao menos dois lançamentos internos no agrupamento.', 400);
  }
  const userId = (request as FastifyRequest & { user: { sub: string } }).user
    .sub;

  const s0 = await prisma.matchSuggestion.findFirst({
    where: {
      id: suggestionId,
      runId,
      reason: SuggestionReason.NO_INTERNAL_MATCH,
    },
    include: {
      bankLinks: { include: { bankRecord: { select: bankSelect } } },
      internalLinks: true,
    },
  });
  if (!s0) {
    throw new HttpError(
      'Sugestão não encontrada ou o motivo não é “só banco (sem par interno)”.',
      404,
    );
  }
  if (s0.status !== SuggestionStatus.OPEN) {
    throw new HttpError('Esta sugestão já foi processada (não está pendente).', 400);
  }
  if (s0.internalLinks.length > 0) {
    throw new HttpError('Esta sugestão já possui lançamentos internos vinculados.', 400);
  }
  const bank = s0.bankLinks[0]?.bankRecord;
  if (!bank) {
    throw new HttpError('Sugestão sem movimento bancário', 400);
  }
  const internals = await prisma.internalRecord.findMany({
    where: { id: { in: internalRecordIds }, runId },
  });
  if (internals.length !== internalRecordIds.length) {
    throw new HttpError(
      'Um ou mais lançamentos internos não existem ou não pertencem a esta execução.',
      400,
    );
  }
  const sum = internals.reduce(
    (a, r) => a.add(r.amount),
    new Prisma.Decimal(0),
  );
  if (!sum.equals(bank.amount)) {
    throw new HttpError(
      'A soma dos internos selecionados não coincide com o valor bancário.',
      400,
    );
  }
  const bScore = {
    amount: bank.amount,
    dueDate: bank.dueDate,
    beneficiaryNameRaw: bank.beneficiaryNameRaw,
    beneficiaryNameNorm: bank.beneficiaryNameNorm,
  };
  const nameScore = Math.round(
    internals
      .map((ir) =>
        nameMatchScore(bScore, {
          amount: ir.amount,
          dueDate: ir.dueDate,
          supplierNameRaw: ir.supplierNameRaw,
          supplierNameNorm: ir.supplierNameNorm,
        }),
      )
      .reduce((a, b) => a + b, 0) / internals.length,
  );
  const overall = Math.max(
    0,
    Math.min(100, Math.round((nameScore + 100 + 100) / 3)),
  );
  const toRemoveIds: string[] = [];
  for (const intId of internalRecordIds) {
    const sInt = await prisma.matchSuggestion.findFirst({
      where: {
        runId,
        id: { not: suggestionId },
        status: SuggestionStatus.OPEN,
        triageBucket: TriageBucket.INTERNAL_ONLY,
        bankLinks: { none: {} },
        internalLinks: { some: { internalRecordId: intId } },
      },
    });
    if (!sInt) {
      throw new HttpError(
        'Um dos internos selecionados não está em triagem “só interno” (sem par banco) pendente, ou foi alterado.',
        400,
      );
    }
    toRemoveIds.push(sInt.id);
  }
  if (new Set(toRemoveIds).size !== toRemoveIds.length) {
    throw new HttpError(
      'A combinação inclui internos vinculados de forma inesperada à mesma sugestão; recarregue a lista.',
      400,
    );
  }
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    if (toRemoveIds.length > 0) {
      await tx.matchSuggestion.deleteMany({ where: { id: { in: toRemoveIds } } });
    }
    for (const intId of internalRecordIds) {
      await tx.suggestionInternalLink.create({
        data: { suggestionId, internalRecordId: intId },
      });
    }
    return tx.matchSuggestion.update({
      where: { id: suggestionId },
      data: {
        status: SuggestionStatus.APPROVED,
        reviewedById: userId,
        confirmedAt: now,
        triageBucket: TriageBucket.VERIFY,
        reason: SuggestionReason.AGGREGATED_CANDIDATE,
        scorePercent: overall,
        nameScore,
        amountScore: 100,
        dateScore: 100,
        amountDifference: null,
        explanation:
          'Vínculo agregado: total dos lançamentos internos = valor do banco (sem 1-1 com mesmo título).',
      },
    });
  });
  return reply.status(200).send({
    suggestion: {
      id: updated.id,
      status: updated.status,
      confirmedAt: updated.confirmedAt?.toISOString() ?? null,
    },
  });
}
