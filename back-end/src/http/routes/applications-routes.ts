import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth-middleware.js';
import { postApplicationsEvent } from '../controllers/applications-events-controller.js';

export async function applicationsRoutes(app: FastifyInstance) {
  app.post('/events', { preHandler: authMiddleware }, postApplicationsEvent);
}
