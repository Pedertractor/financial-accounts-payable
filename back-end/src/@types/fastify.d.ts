import '@fastify/jwt';
import type { $Enums } from '../generated/prisma/client.ts';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: $Enums.UserRole;
    };
    user: {
      sub: string;
      role: $Enums.UserRole;
    };
  }
}
