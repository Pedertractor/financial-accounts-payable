import type { FastifyReply, FastifyRequest } from 'fastify';
import z from 'zod';
import { ReconciliationRunService } from '../../services/reconciliation-run-service.js';

const runIdParams = z.object({ runId: z.string().min(1) });

export async function getReconciliationRunClosePreview(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = runIdParams.parse(request.params);
  const service = new ReconciliationRunService();
  const summary = await service.getClosePreview(params.runId);
  return reply.status(200).send({ summary });
}

export async function closeReconciliationRun(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = runIdParams.parse(request.params);
  const service = new ReconciliationRunService();
  const result = await service.closeRun(params.runId);
  return reply.status(200).send(result);
}

export async function reopenReconciliationRun(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = runIdParams.parse(request.params);
  const service = new ReconciliationRunService();
  const { run } = await service.reopenRun(params.runId);
  return reply.status(200).send({ run });
}
