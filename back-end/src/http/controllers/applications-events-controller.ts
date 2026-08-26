import type { FastifyReply, FastifyRequest } from 'fastify';
import z from 'zod';
import {
  isOrionApplicationsConfigured,
  sendOrionApplicationEvent,
} from '../../integrations/orion-applications-events.js';
import { UserService } from '../../services/user-service.js';
import { HttpError } from '../erros/index.js';

const bodySchema = z.object({
  userName: z.string().optional(),
  cardNumberUser: z.string().optional(),
  ip: z.string().min(1).optional(),
  metadata: z.unknown().optional(),
});

export async function postApplicationsEvent(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!isOrionApplicationsConfigured()) {
    return reply.status(503).send({
      error:
        'Orion não configurado: defina ORION_URL e ORION_APP_TOKEN no ambiente.',
    });
  }

  const body = bodySchema.parse(request.body);
  const usersService = new UserService();
  const user = await usersService.getMe(request.user.sub);

  const payload = {
    userId: user.id,
    ...(body.userName !== undefined
      ? { userName: body.userName }
      : { userName: user.name }),
    ...(body.cardNumberUser !== undefined
      ? { cardNumberUser: body.cardNumberUser }
      : { cardNumberUser: user.cardNumber }),
    ip: body.ip ?? request.ip,
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  };

  const result = await sendOrionApplicationEvent(payload);

  if (result.kind === 'skipped') {
    return reply.status(503).send({
      error:
        'Orion não configurado: defina ORION_URL e ORION_APP_TOKEN no ambiente.',
    });
  }

  if (result.kind === 'throttled') {
    return reply.status(200).send({ ok: true, throttled: true });
  }

  if (result.kind === 'failed') {
    throw new HttpError(
      `Falha ao enviar evento ao Orion (HTTP ${result.status}): ${result.body}`,
      502,
    );
  }

  return reply.status(200).send({ ok: true, orionStatus: result.status });
}
