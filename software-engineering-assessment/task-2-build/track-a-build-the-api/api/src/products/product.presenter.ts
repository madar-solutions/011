import type { Product } from '@prisma/client';

export type ProductJson = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: string;
  stock: number;
  imageUrl: string;
  description: string;
};

export function toProductJson(product: Product): ProductJson {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    price: product.price.toFixed(2),
    stock: product.stock,
    imageUrl: product.imageUrl,
    description: product.description,
  };
}
