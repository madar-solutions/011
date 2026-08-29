import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Coupon, Prisma } from '@prisma/client';
import { ApiException } from '../common/api.exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  emptyCart,
  toCartItemJson,
  type CartJson,
  type CouponAppliedJson,
} from './cart.presenter';
import {
  cartTotals,
  couponDiscount,
  formatMoney,
  toCents,
  type CouponFailure,
  type CouponInput,
} from './cart.totals';

type Tx = Prisma.TransactionClient;

type CartRecord = Prisma.CartGetPayload<{
  include: {
    coupon: true;
    items: { include: { product: true } };
  };
}>;

const lineInclude = {
  product: true,
} as const;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<CartJson> {
    const cart = await this.loadCart(userId);
    if (!cart) return emptyCart();
    if (!cart.coupon || !cart.couponCode) return this.toCartJson(cart);

    const redemptions = await this.redemptionsTx(
      this.prisma,
      userId,
      cart.couponCode,
    );
    const usable = couponDiscount(
      this.toCouponInput(cart.coupon),
      this.totalsOf(cart).subtotalCents,
      new Date(),
      redemptions,
    );
    if (
      !usable.ok &&
      (usable.reason === 'COUPON_LIMIT' || usable.reason === 'COUPON_EXPIRED')
    ) {
      await this.prisma.cart.update({
        where: { userId },
        data: { couponCode: null },
      });
      return this.toCartJson({ ...cart, coupon: null, couponCode: null });
    }
    return this.toCartJson(cart, redemptions);
  }

  async addItem(
    userId: string,
    productId: string,
    quantity = 1,
  ): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureCart(tx, userId);
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'NOT_FOUND',
          'المنتج غير موجود.',
        );
      }
      if (product.stock <= 0) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'OUT_OF_STOCK',
          'المنتج غير متوفر.',
        );
      }
      const existing = await tx.cartItem.findUnique({
        where: { userId_productId: { userId, productId } },
      });
      const nextQuantity = (existing?.quantity ?? 0) + quantity;
      if (nextQuantity > product.stock) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'INSUFFICIENT_STOCK',
          'الكمية المطلوبة غير متوفرة.',
        );
      }
      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: nextQuantity },
        });
        return { id: existing.id };
      }
      const created = await tx.cartItem.create({
        data: {
          id: `ci_${randomUUID()}`,
          userId,
          productId,
          quantity: nextQuantity,
        },
      });
      return { id: created.id };
    });
  }

  async patchItem(
    userId: string,
    lineId: string,
    quantity: number,
  ): Promise<{ id: string; quantity: number }> {
    return this.prisma.$transaction(async (tx) => {
      const line = await this.requireLine(tx, userId, lineId);
      if (quantity > line.product.stock) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'INSUFFICIENT_STOCK',
          'الكمية المطلوبة غير متوفرة.',
        );
      }
      const updated = await tx.cartItem.update({
        where: { id: line.id },
        data: { quantity },
      });
      return { id: updated.id, quantity: updated.quantity };
    });
  }

  async removeItem(userId: string, lineId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const line = await this.requireLine(tx, userId, lineId);
      await tx.cartItem.delete({ where: { id: line.id } });
    });
  }

  async applyCoupon(userId: string, code: string): Promise<CouponAppliedJson> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureCart(tx, userId);
      if (code.length === 0) {
        await tx.cart.update({
          where: { userId },
          data: { couponCode: null },
        });
        const cart = await this.loadCart(userId, tx);
        const discount = cart
          ? formatMoney(this.totalsOf(cart).discountCents)
          : formatMoney(0);
        return { coupon: null, discount };
      }

      const coupon = await tx.coupon.findFirst({
        where: { code: { equals: code, mode: 'insensitive' } },
      });
      if (!coupon) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'COUPON_NOT_FOUND',
          'كود الخصم غير صالح.',
        );
      }

      const cart = await this.loadCart(userId, tx);
      const subtotalCents = cart
        ? this.totalsOf(cart).subtotalCents
        : 0;
      const redemptions = await this.redemptionsTx(tx, userId, coupon.code);
      const result = couponDiscount(
        this.toCouponInput(coupon),
        subtotalCents,
        new Date(),
        redemptions,
      );
      if (!result.ok) throw this.couponException(result.reason);

      await tx.cart.update({
        where: { userId },
        data: { couponCode: coupon.code },
      });
      return {
        coupon: coupon.code,
        discount: formatMoney(result.discountCents),
      };
    });
  }

  private async ensureCart(tx: Tx, userId: string): Promise<void> {
    await tx.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  private async requireLine(tx: Tx, userId: string, lineId: string) {
    const line = await tx.cartItem.findFirst({
      where: { id: lineId, userId },
      include: lineInclude,
    });
    if (!line) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'عنصر السلة غير موجود.',
      );
    }
    return line;
  }

  private loadCart(userId: string, tx: Tx | PrismaService = this.prisma) {
    return tx.cart.findUnique({
      where: { userId },
      include: {
        coupon: true,
        items: { include: lineInclude, orderBy: { id: 'asc' } },
      },
    });
  }

  private toCartJson(
    cart: CartRecord,
    redemptions?: { global: number; user: number },
  ): CartJson {
    const totals = this.totalsOf(cart, redemptions);
    return {
      items: cart.items.map(toCartItemJson),
      coupon: cart.couponCode,
      discount: formatMoney(totals.discountCents),
    };
  }

  private totalsOf(
    cart: CartRecord,
    redemptions?: { global: number; user: number },
  ) {
    const lines = cart.items.map((item) => ({
      priceCents: toCents(item.product.price),
      quantity: item.quantity,
    }));
    return cartTotals(
      lines,
      cart.coupon ? this.toCouponInput(cart.coupon) : null,
      new Date(),
      redemptions,
    );
  }

  private async redemptionsTx(
    tx: Tx | PrismaService,
    userId: string,
    couponCode: string,
  ): Promise<{ global: number; user: number }> {
    const status = { in: ['paid', 'pending'] };
    const [global, user] = await Promise.all([
      tx.order.count({ where: { couponCode, status } }),
      tx.order.count({ where: { couponCode, userId, status } }),
    ]);
    return { global, user };
  }

  private toCouponInput(coupon: Coupon): CouponInput {
    return {
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      minOrder: coupon.minOrder,
      maxRedemptions: coupon.maxRedemptions,
      perUserLimit: coupon.perUserLimit,
      expiresAt: coupon.expiresAt,
    };
  }

  private couponException(reason: CouponFailure): ApiException {
    if (reason === 'COUPON_EXPIRED') {
      return new ApiException(
        HttpStatus.BAD_REQUEST,
        reason,
        'عذرًا، انتهت صلاحية كود الخصم.',
      );
    }
    if (reason === 'COUPON_MIN_ORDER') {
      return new ApiException(
        HttpStatus.BAD_REQUEST,
        reason,
        'قيمة الطلب أقل من الحد الأدنى لهذا الكود.',
      );
    }
    return new ApiException(
      HttpStatus.BAD_REQUEST,
      reason,
      'استُنفد الحد الأقصى لاستخدام هذا الكود.',
    );
  }
}
