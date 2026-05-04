import type { FastifyReply, FastifyRequest } from 'fastify';
import z from 'zod';
import { BankExtratoService } from '../../services/bank-extrato-service.js';
import { HttpError } from '../erros/index.js';

const paramsRun = z.object({ runId: z.string().min(1) });

const stateQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const uploadQuery = z
  .object({
    /** Janela de vencimento (mesmo conceito da lista de sugestões). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (q) => !q.endDate || q.date == null || q.endDate >= q.date,
    { message: 'endDate deve ser >= date' },
  );

const manualBody = z.object({
  extratoLineId: z.string().min(1),
  suggestionId: z.string().min(1),
  justification: z.string().min(1).max(2000),
});

export async function uploadBankExtrato(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { runId } = paramsRun.parse(request.params);
  const q = uploadQuery.parse(request.query);

  const file = await request.file();
  if (!file) {
    throw new HttpError('Arquivo (campo "file") é obrigatório', 400);
  }
  const buffer = await file.toBuffer();
  if (!buffer.length) {
    throw new HttpError('Arquivo vazio', 400);
  }

  const endY = q.endDate ?? q.date;
  const refYmd = q.referenceDate ?? q.date;
  const service = new BankExtratoService();
  const out = await service.importBuffer({
    runId,
    userId: request.user.sub,
    buffer,
    originalFileName: file.filename ?? 'extrato.xlsx',
    referenceDateYmd: refYmd,
    compareFromYmd: q.date,
    compareToYmd: endY,
  });

  return reply.status(201).send(out);
}

export async function getBankExtratoState(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { runId } = paramsRun.parse(request.params);
  const query = stateQuery.parse(request.query);
  const service = new BankExtratoService();
  const body = await service.getState({
    runId,
    referenceDateYmd: query.date,
  });
  return reply.status(200).send(body);
}

export async function postBankExtratoManualMatch(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { runId } = paramsRun.parse(request.params);
  const body = manualBody.parse(request.body);
  const service = new BankExtratoService();
  await service.manualMatch({
    runId,
    userId: request.user.sub,
    extratoLineId: body.extratoLineId,
    suggestionId: body.suggestionId,
    justification: body.justification,
  });
  return reply.status(200).send({ ok: true });
}
