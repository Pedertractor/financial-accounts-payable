import bcrypt from 'bcrypt';
import { $Enums } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import type { UserListRecord } from '../repositories/prisma/user-repository.js';
import { ApiPedertractorEmployee } from '../integrations/api-pedertractor.js';
import { prisma } from '../lib/prisma.js';
import { UserPrismaRepository } from '../repositories/prisma/user-repository.js';
import type { UnitType, UserRole } from '../generated/prisma/enums.js';
import { HttpError } from '../http/erros/index.js';

/** Mensagem exibida quando `active` é false (login e primeiro acesso). */
const MSG_LOGIN_USER_INACTIVE =
  'Este cadastro está desativado e não permite acesso ao sistema. Entre em contato com um administrador ou responsável para solicitar a reativação da sua conta.';

export type PublicUserDto = {
  id: string;
  name: string;
  unit: $Enums.UnitType;
  cardNumber: string;
  role: $Enums.UserRole;
  active: boolean;
  firstLogin: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toPublicUserDto(user: User | UserListRecord): PublicUserDto {
  return {
    id: user.id,
    name: user.name,
    unit: user.unit,
    cardNumber: user.cardNumber,
    role: user.role,
    active: user.active,
    firstLogin: user.firstLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class UserService {
  async register({
    cardNumber,
    unit,
    role,
  }: {
    cardNumber: string;
    unit: UnitType;
    role: UserRole;
  }) {
    const userRepository = new UserPrismaRepository(prisma);
    const userRepositoryApiBase = new ApiPedertractorEmployee();

    const employeeApi = await userRepositoryApiBase.getEmployee({
      cardNumber,
      unit,
    });

    if (!employeeApi.status) {
      throw new HttpError('Colaborador inativo', 404);
    }

    const existingUser = await userRepository.findByCardNumberAndUnit(
      cardNumber,
      unit,
    );

    if (existingUser) {
      throw new HttpError('Colaborador já cadastrado', 400);
    }

    const defaultPassword = employeeApi.cardNumber;
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const newUser = await userRepository.create({
      employeeId: employeeApi.id.toString(),
      name: employeeApi.name,
      unit: employeeApi.unit as $Enums.UnitType,
      cardNumber: employeeApi.cardNumber,
      passwordHash: hashedPassword,
      role,
    });

    return toPublicUserDto(newUser);
  }

  async login({
    cardNumber,
    unit,
    password,
  }: {
    cardNumber: string;
    unit: UnitType;
    password: string;
  }): Promise<PublicUserDto> {
    const userRepository = new UserPrismaRepository(prisma);
    const user = await userRepository.findByCardNumberAndUnit(cardNumber, unit);

    if (!user) {
      throw new HttpError('Credenciais inválidas', 401);
    }

    if (!user.active) {
      throw new HttpError(MSG_LOGIN_USER_INACTIVE, 403);
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      throw new HttpError('Credenciais inválidas', 401);
    }

    return toPublicUserDto(user);
  }

  async completeFirstPassword({
    userId,
    newPassword,
  }: {
    userId: string;
    newPassword: string;
  }): Promise<PublicUserDto> {
    const userRepository = new UserPrismaRepository(prisma);
    const user = await userRepository.findById(userId);

    if (!user) {
      throw new HttpError('Usuário não encontrado', 404);
    }

    if (!user.active) {
      throw new HttpError(MSG_LOGIN_USER_INACTIVE, 403);
    }

    if (!user.firstLogin) {
      throw new HttpError(
        'Primeiro acesso já foi concluído. Use o login normal.',
        400,
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const updated = await userRepository.updateById(userId, {
      passwordHash,
      firstLogin: false,
    });

    return toPublicUserDto(updated);
  }

  async list(params: { active?: boolean }): Promise<PublicUserDto[]> {
    const userRepository = new UserPrismaRepository(prisma);
    const rows = await userRepository.findManyForList(params);
    return rows.map((row) => toPublicUserDto(row));
  }

  async getMe(userId: string): Promise<PublicUserDto> {
    const userRepository = new UserPrismaRepository(prisma);
    const user = await userRepository.findById(userId);

    if (!user) {
      throw new HttpError('Usuário não encontrado', 404);
    }

    if (!user.active) {
      throw new HttpError(MSG_LOGIN_USER_INACTIVE, 403);
    }

    return toPublicUserDto(user);
  }

  async deactivate({
    userId,
    actorUserId,
  }: {
    userId: string;
    actorUserId: string;
  }): Promise<PublicUserDto> {
    const userRepository = new UserPrismaRepository(prisma);
    const user = await userRepository.findById(userId);

    if (!user) {
      throw new HttpError('Usuário não encontrado', 404);
    }

    if (userId === actorUserId) {
      throw new HttpError('Não é possível desativar o próprio usuário', 400);
    }

    const updated = await userRepository.updateById(userId, {
      active: false,
    });

    return toPublicUserDto(updated);
  }

  async update({
    userId,
    name,
    role,
    password,
  }: {
    userId: string;
    name?: string;
    role?: UserRole;
    password?: string;
  }): Promise<PublicUserDto> {
    const userRepository = new UserPrismaRepository(prisma);
    const user = await userRepository.findById(userId);

    if (!user) {
      throw new HttpError('Usuário não encontrado', 404);
    }

    const data: {
      name?: string;
      role?: UserRole;
      passwordHash?: string;
    } = {};
    if (name !== undefined) {
      data.name = name;
    }
    if (role !== undefined) {
      data.role = role;
    }
    if (password !== undefined) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    const updated = await userRepository.updateById(userId, data);
    return toPublicUserDto(updated);
  }
}
