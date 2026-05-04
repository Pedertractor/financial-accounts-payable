import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to run seed');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/** Mesma regra do register: senha inicial = número do cartão. */
const DEFAULT_ADMINS = [
  { cardNumber: '5487', unit: 'PEDERTRACTOR' as const },
  { cardNumber: '5052', unit: 'PEDERTRACTOR' as const },
];

async function main() {
  for (const { cardNumber, unit } of DEFAULT_ADMINS) {
    const existing = await prisma.user.findFirst({
      where: { cardNumber, unit },
    });
    if (existing) {
      console.log(`[seed] skip ${cardNumber} ${unit} (já existe)`);
      continue;
    }

    const passwordHash = await bcrypt.hash(cardNumber, 10);
    await prisma.user.create({
      data: {
        employeeId: `seed-${cardNumber}-peder`,
        name: `Administrador ${cardNumber}`,
        unit,
        cardNumber,
        passwordHash,
        role: 'ADMIN',
      },
    });
    console.log(`[seed] criado admin ${cardNumber} ${unit} (senha inicial = cartão)`);
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
