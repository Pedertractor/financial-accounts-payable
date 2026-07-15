import type { FastifyReply, FastifyRequest } from 'fastify'
import z from 'zod'
import { PaymentVinculoKind, SuggestionStatus } from '../../generated/prisma/enums.js'
import { HttpError } from '../erros/index.js'
import { normalizeCounterpartyName } from '../../lib/name-normalize.js'
import {
  paymentVinculoHasDetails,
  vinculoKindFromSuggestion,
} from '../../lib/payment-vinculo-helpers.js'
import { prisma } from '../../lib/prisma.js'

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
})

const idParamSchema = z.object({ id: z.string().min(1) })

const instructionParamSchema = z.object({
  runId: z.string().min(1),
  suggestionId: z.string().min(1),
})

const updateBodySchema = z.object({
  registroNome: z.string().max(500).nullable().optional(),
  userCode: z.string().max(64).nullable().optional(),
  pixChave: z.string().max(200).nullable().optional(),
  tedBanco: z.string().max(200).nullable().optional(),
  tedAgencia: z.string().max(32).nullable().optional(),
  tedConta: z.string().max(32).nullable().optional(),
  tedCnpj: z.string().max(32).nullable().optional(),
})

function serializeVinculoRow(r: {
  id: string
  kind: PaymentVinculoKind
  displayName: string
  normalizedName: string
  registroNome: string | null
  userCode: string | null
  pixChave: string | null
  tedBanco: string | null
  tedAgencia: string | null
  tedConta: string | null
  tedCnpj: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: r.id,
    kind: r.kind,
    displayName: r.displayName,
    normalizedName: r.normalizedName,
    registroNome: r.registroNome,
    userCode: r.userCode,
    pixChave: r.pixChave,
    tedBanco: r.tedBanco,
    tedAgencia: r.tedAgencia,
    tedConta: r.tedConta,
    tedCnpj: r.tedCnpj,
    hasDetails: paymentVinculoHasDetails(r),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

export async function listPaymentVinculoNames(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const q = listQuerySchema.parse(request.query ?? {})
  const page = q.page
  const pageSize = q.pageSize
  const skip = (page - 1) * pageSize

  const [total, rows] = await Promise.all([
    prisma.paymentVinculoName.count(),
    prisma.paymentVinculoName.findMany({
      orderBy: [{ kind: 'asc' }, { displayName: 'asc' }, { id: 'asc' }],
      skip,
      take: pageSize,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return reply.status(200).send({
    items: rows.map((r) => serializeVinculoRow(r)),
    total,
    page,
    pageSize,
    totalPages,
  })
}

export async function getPaymentVinculoById(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = idParamSchema.parse(request.params)
  const r = await prisma.paymentVinculoName.findUnique({ where: { id } })
  if (!r) {
    throw new HttpError('Registro não encontrado', 404)
  }
  return reply.status(200).send({ vinculo: serializeVinculoRow(r) })
}

export async function putPaymentVinculoById(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = idParamSchema.parse(request.params)
  const body = updateBodySchema.parse(request.body ?? {})
  const existing = await prisma.paymentVinculoName.findUnique({ where: { id } })
  if (!existing) {
    throw new HttpError('Registro não encontrado', 404)
  }
  const data: Record<string, unknown> = {}
  for (const k of [
    'registroNome',
    'userCode',
    'pixChave',
    'tedBanco',
    'tedAgencia',
    'tedConta',
    'tedCnpj',
  ] as const) {
    if (body[k] !== undefined) {
      data[k] = body[k] === null || body[k] === '' ? null : body[k]
    }
  }
  const r = await prisma.paymentVinculoName.update({
    where: { id },
    data: data as object,
  })
  return reply.status(200).send({ vinculo: serializeVinculoRow(r) })
}

/**
 * Dados de pagamento (PIX/TED) para a linha da triagem, com vencimento e valor do ERP.
 */
export async function getPaymentVinculoInstruction(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { runId, suggestionId } = instructionParamSchema.parse(
    request.params,
  )
  const s = await prisma.matchSuggestion.findFirst({
    where: { id: suggestionId, runId, status: SuggestionStatus.APPROVED },
    include: {
      internalLinks: { include: { internalRecord: true } },
      bankLinks: { include: { bankRecord: true } },
    },
  })
  if (!s) {
    throw new HttpError(
      'Sugestão não encontrada ou ainda não está conferida',
      404,
    )
  }
  const vk = vinculoKindFromSuggestion({
    paymentVinculoKind: s.paymentVinculoKind,
    reason: s.reason,
  })
  if (!vk) {
    throw new HttpError(
      'Esta sugestão não é de pagamento PIX, TED ou boleto manual aprovado.',
      400,
    )
  }

  if (vk === PaymentVinculoKind.BOLETO) {
    const b0 = s.bankLinks[0]?.bankRecord
    const int0 = s.internalLinks[0]?.internalRecord
    const fromBank = b0 != null
    const fromErp = int0 != null
    if (!fromBank && !fromErp) {
      throw new HttpError('Sem lançamento bancário ou ERP vinculado', 400)
    }
    const amount = (fromBank ? b0!.amount : int0!.amount).toString()
    const due = fromBank ? b0!.dueDate : int0!.dueDate
    const dueDate = due
      ? due.toLocaleDateString('en-CA', {
        timeZone: 'America/Sao_Paulo',
      })
      : null
    const hasEv =
      s.manualBoletoEvidenceRelPath != null
      && s.manualBoletoEvidenceRelPath.length > 0
    const beneficiaryName = fromBank
      ? b0!.beneficiaryNameRaw
      : int0!.supplierNameRaw
    return reply.status(200).send({
      kind: 'BOLETO' as const,
      amount,
      amountFormatted: amount,
      dueDate,
      hasRegistryDetails: hasEv,
      beneficiaryName,
      manualLinkNotes: s.manualLinkNotes ?? null,
      vinculo: null,
      paidAt: s.paidAt ? s.paidAt.toISOString() : null,
      /** true = valor/nome vêm do ERP (sem par banco). */
      sourceFromErp: !fromBank,
      evidencePath: hasEv
        ? `/reconciliation/runs/${runId}/suggestions/${suggestionId}/manual-boleto-evidence`
        : null,
    })
  }

  const int0 = s.internalLinks[0]?.internalRecord
  if (!int0) {
    throw new HttpError('Sem lançamento interno/ERP vinculado', 400)
  }
  const norm = normalizeCounterpartyName(int0.supplierNameRaw)
  if (!norm.length) {
    throw new HttpError('Não foi possível normalizar o fornecedor', 400)
  }
  const reg = await prisma.paymentVinculoName.findUnique({
    where: { normalizedName_kind: { normalizedName: norm, kind: vk } },
  })
  const amount = int0.amount.toString()
  const dueDate = int0.dueDate
    ? int0.dueDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    : null
  return reply.status(200).send({
    kind: vk,
    amount,
    amountFormatted: int0.amount.toString(),
    dueDate,
    hasRegistryDetails: reg != null && paymentVinculoHasDetails(reg),
    vinculo: reg ? serializeVinculoRow(reg) : null,
    paidAt: s.paidAt ? s.paidAt.toISOString() : null,
    beneficiaryName: null,
    manualLinkNotes: null,
    evidencePath: null,
  })
}
