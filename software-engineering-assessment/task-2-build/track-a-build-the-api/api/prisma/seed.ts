import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash as hashPassword } from 'bcryptjs';
import { PrismaClient, type CouponType } from '@prisma/client';

type SeedFile = {
  users: Array<{
    id: string;
    username: string;
    password: string;
    displayName: string;
  }>;
  products: Array<{
    id: string;
    sku: string;
    name: string;
    category: string;
    price: string;
    stock: number;
    imageUrl: string;
    description: string;
  }>;
  coupons: Array<{
    code: string;
    type: CouponType;
    value: string;
    minOrder?: string;
    maxRedemptions?: number;
    perUserLimit?: number;
    expiresAt?: string;
  }>;
};

function seedPath(): string {
  const candidates = [
    process.env.SEED_PATH,
    resolve(process.cwd(), 'seed.json'),
    resolve(process.cwd(), '../seed.json'),
    resolve(__dirname, '../../seed.json'),
  ].filter((p): p is string => Boolean(p));

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `seed.json not found. Looked in: ${candidates.join(', ')}`,
    );
  }
  return found;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const seed = JSON.parse(readFileSync(seedPath(), 'utf8')) as SeedFile;

  try {
    for (const user of seed.users) {
      const passwordHash = await hashPassword(user.password, 10);
      await prisma.user.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          username: user.username,
          passwordHash,
          displayName: user.displayName,
        },
        update: {
          username: user.username,
          passwordHash,
          displayName: user.displayName,
        },
      });
    }

    for (const product of seed.products) {
      await prisma.product.upsert({
        where: { id: product.id },
        create: product,
        update: {
          sku: product.sku,
          name: product.name,
          category: product.category,
          price: product.price,
          stock: product.stock,
          imageUrl: product.imageUrl,
          description: product.description,
        },
      });
    }

    for (const coupon of seed.coupons) {
      const data = {
        type: coupon.type,
        value: coupon.value,
        minOrder: coupon.minOrder ?? null,
        maxRedemptions: coupon.maxRedemptions ?? null,
        perUserLimit: coupon.perUserLimit ?? null,
        expiresAt: coupon.expiresAt ? new Date(coupon.expiresAt) : null,
      };
      await prisma.coupon.upsert({
        where: { code: coupon.code },
        create: { code: coupon.code, ...data },
        update: data,
      });
    }

    process.stdout.write(
      `seeded ${seed.users.length} users, ${seed.products.length} products, ${seed.coupons.length} coupons\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
