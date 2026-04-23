import type { FastifyReply, FastifyRequest } from 'fastify';
import { $Enums } from '../generated/prisma/client';

export function roleMiddleware(requiredRole: $Enums.UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requiredRole.includes(request.user.role)) {
      return reply.status(403).send({
        error: 'Sem permissão para realizar esta ação',
      });
    }
  };
}
