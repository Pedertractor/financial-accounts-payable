import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { env } from './env/index.js';
import { ZodError } from 'zod';
import { HttpError } from './http/erros/index.js';
import { mainRoutes } from './http/routes/main.js';

export const app = Fastify();

app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

app.register(jwt, {
  secret: env.JWT_SECRET,
});

app.register(mainRoutes, { prefix: '/api' });

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

app.setErrorHandler((error, _, reply) => {
  if (error instanceof HttpError) {
    return reply.status(error.statusCode).send({
      error: error.message,
      ...(error.details ?? {}),
    });
  }

  const code = getErrorCode(error);

  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return reply.status(413).send({
      error: 'O corpo da requisição excede o tamanho máximo permitido.',
    });
  }

  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    const message = firstIssue?.message ?? 'Erro de validação';
    return reply.status(400).send({
      error: message,
    });
  }

  // Log para diagnóstico; devolve mensagem real para o cliente ter feedback
  console.error('Unhandled error:', error);
  const message =
    error instanceof Error ? error.message : 'Internal server error';
  return reply.status(500).send({
    error: message,
  });
});
