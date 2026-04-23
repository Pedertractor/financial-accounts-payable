import type { FastifyInstance } from 'fastify';
import { userRoutes } from './user-routes';

export async function mainRoutes(app: FastifyInstance) {
  app.register(userRoutes, { prefix: '/users' });
}
