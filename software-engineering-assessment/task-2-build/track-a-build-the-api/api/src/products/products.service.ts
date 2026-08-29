import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ApiException } from '../common/api.exception';
import { PrismaService } from '../prisma/prisma.service';
import { toProductJson, type ProductJson } from './product.presenter';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q?: string): Promise<{ items: ProductJson[] }> {
    const where: Prisma.ProductWhereInput | undefined = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined;

    const products = await this.prisma.product.findMany({
      where,
      orderBy: { id: 'asc' },
    });
    return { items: products.map(toProductJson) };
  }

  async getById(id: string): Promise<ProductJson> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'المنتج غير موجود.',
      );
    }
    return toProductJson(product);
  }
}
