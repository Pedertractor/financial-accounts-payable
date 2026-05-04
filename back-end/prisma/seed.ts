import 'dotenv/config';
import bcrypt from 'bcrypt';
import { $Enums } from '../src/generated/prisma/client.js';
import type { UnitType } from '../src/generated/prisma/enums.js';
import { ApiPedertractorEmployee } from '../src/integrations/api-pedertractor.js';
import { HttpError } from '../src/http/erros/index.js';
import { prisma } from '../src/lib/prisma.js';
import { UserPrismaRepository } from '../src/repositories/prisma/user-repository.js';

const DEFAULT_ADMINS: { cardNumber: string; unit: UnitType }[] = [
  { cardNumber: '5487', unit: 'PEDERTRACTOR' },
  { cardNumber: '5052', unit: 'PEDERTRACTOR' },
];

async function main() {
  const userRepository = new UserPrismaRepository(prisma);
  const userRepositoryApiBase = new ApiPedertractorEmployee();

  for (const { cardNumber, unit } of DEFAULT_ADMINS) {
    const existingUser = await userRepository.findByCardNumberAndUnit(
      cardNumber,
      unit,
    );

    if (existingUser) {
      console.log(`[seed] skip ${cardNumber} ${unit} (já cadastrado)`);
      continue;
    }

    const employeeApi = await userRepositoryApiBase.getEmployee({
      cardNumber,
      unit,
    });

    if (!employeeApi.status) {
      throw new HttpError('Colaborador inativo', 404);
    }

    const defaultPassword = employeeApi.cardNumber;
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    await userRepository.create({
      employeeId: employeeApi.id.toString(),
      name: employeeApi.name,
      unit: employeeApi.unit as $Enums.UnitType,
      cardNumber: employeeApi.cardNumber,
      passwordHash: hashedPassword,
      role: 'ADMIN',
    });

    console.log(
      `[seed] criado admin ${employeeApi.cardNumber} ${employeeApi.unit} (senha inicial = cartão)`,
    );
  }
}

await main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
