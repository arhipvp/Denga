import 'dotenv/config';
import { CategoryType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_CHILD_NAME = 'Общее';

async function migrateType(householdId: string, type: CategoryType) {
  const categories = await prisma.category.findMany({
    where: {
      householdId,
      type,
      parentId: null,
      children: {
        none: {},
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  for (const category of categories) {
    const parent = await prisma.category.create({
      data: {
        householdId,
        name: category.name,
        type,
        isActive: category.isActive,
      },
    });

    await prisma.category.update({
      where: { id: category.id },
      data: {
        parentId: parent.id,
        name: DEFAULT_CHILD_NAME,
      },
    });
  }
}

async function main() {
  const households = await prisma.household.findMany({
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const household of households) {
    await migrateType(household.id, CategoryType.EXPENSE);
    await migrateType(household.id, CategoryType.INCOME);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
