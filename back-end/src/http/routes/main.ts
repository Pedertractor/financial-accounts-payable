import type { FastifyInstance } from 'fastify';
import { applicationsRoutes } from './applications-routes.js';
import { reconciliationRoutes } from './reconciliation-routes.js';
import { userRoutes } from './user-routes.js';

export async function mainRoutes(app: FastifyInstance) {
  app.register(userRoutes, { prefix: '/users' });
  app.register(reconciliationRoutes, { prefix: '/reconciliation' });
  app.register(applicationsRoutes, { prefix: '/applications' });
}
