import type { FastifyReply, FastifyRequest } from 'fastify';
import z from 'zod';
import { SourceType, UnitType } from '../../generated/prisma/enums.js';
import { HttpError } from '../erros/index.js';
import { FileImportService } from '../../services/file-import-service.js';

const createRunBody = z.object({
  title: z.string().max(200).optional(),
  unit: z.nativeEnum(UnitType),
  referenceStartDate: z.string().optional().nullable(),
  referenceEndDate: z.string().optional().nullable(),
});

export async function createReconciliationRun(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const body = createRunBody.parse(request.body);
  const service = new FileImportService();
  const run = await service.createRun({
    userId: request.user.sub,
    unit: body.unit,
    title: body.title,
    referenceStartDate: body.referenceStartDate,
    referenceEndDate: body.referenceEndDate,
  });
  return reply.status(201).send({ run });
}

export async function getReconciliationRun(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = z
    .object({ runId: z.string().min(1) })
    .parse(request.params);
  const service = new FileImportService();
  const run = await service.getRunOrThrow(params.runId);
  return reply.status(200).send({ run });
}

/** Última execução do usuário (reabre triagem sem reimportar). */
const latestRunQuery = z.object({
  unit: z.nativeEnum(UnitType),
});

export async function getLatestReconciliationRun(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const q = latestRunQuery.parse(request.query);
  const service = new FileImportService();
  const run = await service.getLatestRunForUser(request.user.sub, q.unit);
  return reply.status(200).send({ run: run ?? null });
}

/**
 * Depois de importar banco e ERP, grava no banco as sugestões de vínculo e triagem.
 * (A importação por arquivo deixa de disparar o match automaticamente.)
 */
export async function finalizeReconciliationRun(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = z.object({ runId: z.string().min(1) }).parse(request.params);
  const service = new FileImportService();
  const { created } = await service.finalizeRunWithSuggestions(
    params.runId,
    request.user.sub,
  );
  return reply.status(200).send({
    created,
    message: 'Sugestões de vínculo e triagem gravadas para esta execução.',
  });
}

export async function uploadBankFile(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = z
    .object({ runId: z.string().min(1) })
    .parse(request.params);
  const file = await request.file();
  if (!file) {
    throw new HttpError('Arquivo (campo "file") é obrigatório', 400);
  }
  const buffer = await file.toBuffer();
  if (!buffer.length) {
    throw new HttpError('Arquivo vazio', 400);
  }
  const service = new FileImportService();
  const { fileUploadId } = await service.saveUploadAndQueueProcess({
    runId: params.runId,
    userId: request.user.sub,
    sourceType: SourceType.BANK,
    buffer,
    originalFileName: file.filename,
    mimetype: file.mimetype,
  });
  return reply
    .status(201)
    .send({ fileUploadId, message: 'Recebido; importação em processamento.' });
}

export async function uploadInternalFile(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = z
    .object({ runId: z.string().min(1) })
    .parse(request.params);
  const file = await request.file();
  if (!file) {
    throw new HttpError('Arquivo (campo "file") é obrigatório', 400);
  }
  const buffer = await file.toBuffer();
  if (!buffer.length) {
    throw new HttpError('Arquivo vazio', 400);
  }
  const service = new FileImportService();
  const { fileUploadId } = await service.saveUploadAndQueueProcess({
    runId: params.runId,
    userId: request.user.sub,
    sourceType: SourceType.INTERNAL,
    buffer,
    originalFileName: file.filename,
    mimetype: file.mimetype,
  });
  return reply
    .status(201)
    .send({ fileUploadId, message: 'Recebido; importação em processamento.' });
}

const listUploadsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export async function listRecentUploads(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const q = listUploadsQuery.parse(request.query);
  const service = new FileImportService();
  const uploads = await service.listRecentFinishedUploads(q.limit);
  return reply.status(200).send({ uploads });
}

export async function getFileUploadStatus(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = z
    .object({ fileUploadId: z.string().min(1) })
    .parse(request.params);
  const service = new FileImportService();
  const u = await service.getUploadOrThrow(params.fileUploadId);
  const fileUpload = service.toUploadStatusDto(u);
  return reply.status(200).send({ fileUpload });
}

export async function confirmStagedFileUpload(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = z
    .object({ fileUploadId: z.string().min(1) })
    .parse(request.params);
  const service = new FileImportService();
  await service.confirmStagedImport(params.fileUploadId);
  const u = await service.getUploadOrThrow(params.fileUploadId);
  return reply
    .status(200)
    .send({ fileUpload: service.toUploadStatusDto(u) });
}

export async function cancelStagedFileUpload(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = z
    .object({ fileUploadId: z.string().min(1) })
    .parse(request.params);
  const service = new FileImportService();
  await service.cancelStagedImport(params.fileUploadId);
  return reply.status(200).send({ ok: true });
}

export async function removeImportData(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = z
    .object({ fileUploadId: z.string().min(1) })
    .parse(request.params);
  const service = new FileImportService();
  await service.removeImportDataForUpload(params.fileUploadId);
  return reply.status(204).send();
}
