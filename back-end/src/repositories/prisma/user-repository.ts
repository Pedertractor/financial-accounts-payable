import type {
  Prisma,
  PrismaClient,
  UnitType,
  User,
} from '../../generated/prisma/client.js';

const userListSelect = {
  id: true,
  employeeId: true,
  name: true,
  unit: true,
  cardNumber: true,
  role: true,
  active: true,
  firstLogin: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type UserListRecord = Prisma.UserGetPayload<{
  select: typeof userListSelect;
}>;

export class UserPrismaRepository {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  async findByCardNumberAndUnit(
    cardNumber: string,
    unit: UnitType,
  ): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: {
        cardNumber_unit: {
          cardNumber,
          unit,
        },
      },
    });
  }

  async create(user: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({
      data: user,
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findManyForList(params: {
    active?: boolean;
  }): Promise<UserListRecord[]> {
    return this.prisma.user.findMany({
      ...(params.active === undefined
        ? {}
        : { where: { active: params.active } }),
      orderBy: { name: 'asc' },
      select: userListSelect,
    });
  }

  async updateById(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }
}
