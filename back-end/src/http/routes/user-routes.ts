import type { FastifyInstance } from 'fastify';

import { UserRole } from '../../generated/prisma/enums.js';
import { authMiddleware } from '../../middleware/auth-middleware.js';
import { roleMiddleware } from '../../middleware/auth-role-middleware.js';
import {
  completeFirstPasswordUser,
  deactivateUser,
  getMeUser,
  listUsers,
  loginUser,
  registerUser,
  updateUser,
} from '../controllers/user-controller.js';

const adminOrResponsiblePreHandler = [
  authMiddleware,
  roleMiddleware([UserRole.FINANCIAL, UserRole.ADMIN]),
];

export async function userRoutes(app: FastifyInstance) {
  app.post('/login', loginUser);
  app.post('/first-password', completeFirstPasswordUser);
  app.get('/me', { preHandler: authMiddleware }, getMeUser);
  app.get('/', { preHandler: adminOrResponsiblePreHandler }, listUsers);
  app.post('/', { preHandler: adminOrResponsiblePreHandler }, registerUser);
  app.put('/:id', { preHandler: adminOrResponsiblePreHandler }, updateUser);
  app.patch(
    '/:id/deactivate',
    { preHandler: adminOrResponsiblePreHandler },
    deactivateUser,
  );
}
