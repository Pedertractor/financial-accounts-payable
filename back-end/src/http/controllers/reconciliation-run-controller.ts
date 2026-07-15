import type { FastifyReply, FastifyRequest } from 'fastify';
import z from 'zod';
import { RunStatus, UnitType } from '../../generated/prisma/enums.js';
import { ReconciliationRunService } from '../../services/reconciliation-run-service.js';

const runIdParams = z.object({ runId: z.string().min(1) });

const listRunsQuery = z.object({
  unit: z.nativeEnum(UnitType),
  status: z.nativeEnum(RunStatus).optional(),
});

export async function listReconciliationRuns(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const q = listRunsQuery.parse(request.query);
  const service = new ReconciliationRunService();
  const runs = await service.listRuns(q.unit, q.status);
  return reply.status(200).send({ runs });
}

const listRecordsQuery = z.object({
  type: z.enum(['bank', 'internal']),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function listRunRecords(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = runIdParams.parse(request.params);
  const q = listRecordsQuery.parse(request.query);
  const service = new ReconciliationRunService();
  const result = await service.listRunRecords(
    params.runId,
    q.type,
    q.page ?? 1,
    q.pageSize ?? 50,
  );
  return reply.status(200).send(result);
}

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

export async function deleteReconciliationRun(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = runIdParams.parse(request.params);
  const service = new ReconciliationRunService();
  await service.deleteEmptyRun(params.runId);
  return reply.status(204).send();
}
