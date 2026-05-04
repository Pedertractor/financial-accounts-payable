import type { FastifyReply, FastifyRequest } from 'fastify';
import { UserService } from '../../services/user-service.js';
import { UnitType, UserRole } from '../../generated/prisma/enums.js';
import z from 'zod';

export async function loginUser(request: FastifyRequest, reply: FastifyReply) {
  const bodySchema = z.object({
    cardNumber: z.string().min(1),
    unit: z.enum(UnitType),
    password: z.string().min(1),
  });

  const { cardNumber, unit, password } = bodySchema.parse(request.body);

  const usersService = new UserService();
  const user = await usersService.login({ cardNumber, unit, password });

  if (user.firstLogin) {
    return reply.status(200).send({
      firstLoginRequired: true,
      user,
    });
  }

  const token = await reply.jwtSign({
    sub: user.id,
    role: user.role,
  });

  return reply.status(200).send({
    firstLoginRequired: false,
    token,
    user,
  });
}

export async function completeFirstPasswordUser(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const bodySchema = z.object({
    userId: z.string().min(1),
    newPassword: z.string().min(6),
  });

  const { userId, newPassword } = bodySchema.parse(request.body);

  const usersService = new UserService();
  const user = await usersService.completeFirstPassword({
    userId,
    newPassword,
  });

  const token = await reply.jwtSign({
    sub: user.id,
    role: user.role,
  });

  return reply.status(200).send({
    firstLoginRequired: false,
    token,
    user,
  });
}

export async function getMeUser(request: FastifyRequest, reply: FastifyReply) {
  const usersService = new UserService();
  const user = await usersService.getMe(request.user.sub);

  return reply.status(200).send({ user });
}

export async function listUsers(request: FastifyRequest, reply: FastifyReply) {
  const querySchema = z.object({
    active: z
      .union([z.literal('true'), z.literal('false')])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
  });

  const { active } = querySchema.parse(request.query);

  const usersService = new UserService();
  const listParams = active === undefined ? {} : { active };
  const users = await usersService.list(listParams);

  return reply.status(200).send({ users });
}

export async function registerUser(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const bodySchema = z.object({
    cardNumber: z.string().min(1),
    unit: z.enum(UnitType),
    role: z.enum(UserRole),
  });

  const { cardNumber, unit, role } = bodySchema.parse(request.body);

  const usersService = new UserService();
  const user = await usersService.register({ cardNumber, unit, role });

  return reply.status(201).send({ user });
}

export async function updateUser(request: FastifyRequest, reply: FastifyReply) {
  const paramsSchema = z.object({
    id: z.string().min(1),
  });

  const bodySchema = z
    .object({
      name: z.string().min(1).optional(),
      role: z.enum(UserRole).optional(),
      password: z.string().min(6).optional(),
    })
    .refine(
      (b) =>
        b.name !== undefined ||
        b.role !== undefined ||
        b.password !== undefined,
      { message: 'Informe ao menos um campo para atualizar.' },
    );

  const { id } = paramsSchema.parse(request.params);
  const body = bodySchema.parse(request.body);

  const usersService = new UserService();
  const user = await usersService.update({
    userId: id,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.password !== undefined ? { password: body.password } : {}),
  });

  return reply.status(200).send({ user });
}

export async function deactivateUser(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const paramsSchema = z.object({
    id: z.string().min(1),
  });

  const { id } = paramsSchema.parse(request.params);

  const usersService = new UserService();
  const user = await usersService.deactivate({
    userId: id,
    actorUserId: request.user.sub,
  });

  return reply.status(200).send({ user });
}

export async function activateUser(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const paramsSchema = z.object({
    id: z.string().min(1),
  });

  const { id } = paramsSchema.parse(request.params);

  const usersService = new UserService();
  const user = await usersService.activate({
    userId: id,
    actorUserId: request.user.sub,
  });

  return reply.status(200).send({ user });
}

export async function resetFirstLoginUser(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const paramsSchema = z.object({
    id: z.string().min(1),
  });

  const { id } = paramsSchema.parse(request.params);

  const usersService = new UserService();
  const user = await usersService.resetFirstAccess({
    userId: id,
    actorUserId: request.user.sub,
  });

  return reply.status(200).send({ user });
}
