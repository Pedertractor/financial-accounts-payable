import type { FastifyReply, FastifyRequest } from 'fastify';
import z from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import {
  PaymentVinculoKind,
  SuggestionReason,
  SuggestionStatus,
} from '../../generated/prisma/enums.js';
import { HttpError } from '../erros/index.js';
import {
  includeAsNamedCandidate,
  matchKey,
  MIN_NAME_SCORE_CANDIDATE_LIST,
  nameMatchScore,
  recomputeMatchSuggestionFields,
} from '../../services/suggestion-pair-scoring.js';
import { normalizeCounterpartyName } from '../../lib/name-normalize.js';
import {
  paymentVinculoHasDetails,
  vinculoKindFromSuggestion,
} from '../../lib/payment-vinculo-helpers.js';
import { prisma } from '../../lib/prisma.js';

const paramsSchema = z.object({ runId: z.string().min(1) });

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  statusFilter: z
    .enum(['todos', 'pendente', 'conferido', 'pago'])
    .optional()
    .default('todos'),
});

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

/** Janela [00:00, 24:00) em America/Sao_Paulo (offset fixo -03, sem horário de verão). */
function saoPauloDayRange(ymd: string): { gte: Date; lt: Date } {
  const gte = new Date(`${ymd}T00:00:00-03:00`);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
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
        const { gte, lt } = saoPauloDayRange(query.date!);
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

  const [total, pendente, conferido, pago, suggestions] = await Promise.all([
    prisma.matchSuggestion.count({ where: baseWhere }),
    prisma.matchSuggestion.count({
      where: { ...baseWhere, status: SuggestionStatus.OPEN },
    }),
    prisma.matchSuggestion.count({
      where: {
        ...baseWhere,
        status: SuggestionStatus.APPROVED,
        paidAt: null,
      },
    }),
    prisma.matchSuggestion.count({
      where: { ...baseWhere, paidAt: { not: null } },
    }),
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
  const vinculoRows =
    vinculoOr.length === 0
      ? []
      : await prisma.paymentVinculoName.findMany({
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
        });
  const vinculoByNormKind = new Map(
    vinculoRows.map((r) => [
      `${r.normalizedName}\t${r.kind}`,
      { id: r.id, hasDetails: paymentVinculoHasDetails(r) },
    ]),
  );

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
    const intAmt = inners[0] ? decimalStr(inners[0].amount) : null;
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
    };
  });

  return reply.status(200).send({
    run,
    filter: {
      compareDate: query.date ?? null,
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
