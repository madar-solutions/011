import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Coupon, Prisma } from '@prisma/client';
import {
  cartTotals,
  couponDiscount,
  formatMoney,
  toCents,
  type CouponFailure,
  type CouponInput,
} from '../cart/cart.totals';
import { ApiException } from '../common/api.exception';
import { errorEnvelope, type StoredHttp } from '../common/error-envelope';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { withIdempotency } from './idempotency';
import { toOrderDetail, toOrderListItem, type OrderDetailJson, type OrderListItemJson } from './order.presenter';
import { chargeCard, type ChargeCard } from './payments.client';

type Tx = Prisma.TransactionClient;

type ReservedLine = {
  productId: string;
  name: string;
  quantity: number;
  priceCents: number;
};

type PreparedCheckout = {
  lines: ReservedLine[];
  totalCents: number;
  couponCode: string | null;
};

const lineInclude = { product: true } as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async place(
    userId: string,
    requestId: string,
    card: ChargeCard,
  ): Promise<StoredHttp> {
    const ttlSeconds = Number(this.config.get('SESSION_TTL_SECONDS') ?? 86400);
    const timeoutMs = Number(this.config.get('PAYMENTS_TIMEOUT_MS') ?? 15000);
    const key = `idempotency:${userId}:${requestId}`;
    return withIdempotency(
      this.redis,
      key,
      ttlSeconds,
      timeoutMs + 5_000,
      () => this.checkout(userId, requestId, card, timeoutMs),
    );
  }

  async list(userId: string): Promise<{ items: OrderListItemJson[] }> {
    const orders = await this.prisma.order.findMany({
      where: { userId, status: 'paid' },
      orderBy: { createdAt: 'desc' },
    });
    return { items: orders.map(toOrderListItem) };
  }

  async getById(userId: string, id: string): Promise<OrderDetailJson> {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!order) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'الطلب غير موجود.',
      );
    }
    return toOrderDetail(order);
  }

  private async checkout(
    userId: string,
    requestId: string,
    card: ChargeCard,
    timeoutMs: number,
  ): Promise<StoredHttp> {
    const prepared = await this.prepare(userId);
    await this.reserve(prepared.lines);
    let charged = false;
    try {
      const charge = await chargeCard({
        url: this.config.getOrThrow<string>('PAYMENTS_URL'),
        timeoutMs,
        amount: formatMoney(prepared.totalCents),
        card,
        reference: requestId,
      });
      if (charge.kind === 'declined') {
        await this.release(prepared.lines);
        return {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          body: errorEnvelope(
            'CARD_DECLINED',
            'عذرًا، رُفضت البطاقة.',
          ),
        };
      }
      if (charge.kind === 'unavailable') {
        await this.release(prepared.lines);
        return {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          body: errorEnvelope(
            'UNAVAILABLE',
            'تعذّر الاتصال ببوابة الدفع. حاول مرة أخرى.',
          ),
        };
      }
      charged = true;
      const order = await this.commit(
        userId,
        requestId,
        prepared,
        charge.chargeId,
      );
      return { statusCode: HttpStatus.CREATED, body: toOrderListItem(order) };
    } catch (error) {
      if (!charged) await this.release(prepared.lines);
      throw error;
    }
  }

  private async prepare(userId: string): Promise<PreparedCheckout> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        coupon: true,
        items: { include: lineInclude, orderBy: { id: 'asc' } },
      },
    });
    if (!cart || cart.items.length === 0) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION',
        'السلة فارغة.',
      );
    }

    const redemptions = cart.coupon
      ? await this.redemptions(userId, cart.coupon.code)
      : undefined;
    if (cart.coupon) {
      const subtotalCents = cart.items.reduce(
        (sum, item) => sum + toCents(item.product.price) * item.quantity,
        0,
      );
      const usable = couponDiscount(
        this.toCouponInput(cart.coupon),
        subtotalCents,
        new Date(),
        redemptions,
      );
      if (!usable.ok) throw this.couponException(usable.reason);
    }

    const totals = cartTotals(
      cart.items.map((item) => ({
        priceCents: toCents(item.product.price),
        quantity: item.quantity,
      })),
      cart.coupon ? this.toCouponInput(cart.coupon) : null,
      new Date(),
      redemptions,
    );

    return {
      lines: cart.items.map((item) => ({
        productId: item.productId,
        name: item.product.name,
        quantity: item.quantity,
        priceCents: toCents(item.product.price),
      })),
      totalCents: totals.totalCents,
      couponCode: cart.couponCode,
    };
  }

  private async redemptions(
    userId: string,
    couponCode: string,
  ): Promise<{ global: number; user: number }> {
    const [global, user] = await Promise.all([
      this.prisma.order.count({
        where: { couponCode, status: 'paid' },
      }),
      this.prisma.order.count({
        where: { couponCode, userId, status: 'paid' },
      }),
    ]);
    return { global, user };
  }

  private async reserve(lines: ReservedLine[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const updated = await tx.product.updateMany({
          where: { id: line.productId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (updated.count !== 1) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'INSUFFICIENT_STOCK',
            'الكمية المطلوبة غير متوفرة.',
          );
        }
      }
    });
  }

  private async release(lines: ReservedLine[]): Promise<void> {
    await this.prisma.$transaction(async (tx: Tx) => {
      for (const line of lines) {
        await tx.product.update({
          where: { id: line.productId },
          data: { stock: { increment: line.quantity } },
        });
      }
    });
  }

  private async commit(
    userId: string,
    requestId: string,
    prepared: PreparedCheckout,
    chargeId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          id: `o_${randomUUID()}`,
          userId,
          status: 'paid',
          total: formatMoney(prepared.totalCents),
          couponCode: prepared.couponCode,
          chargeId,
          requestId,
          items: {
            create: prepared.lines.map((line) => ({
              id: randomUUID(),
              productId: line.productId,
              name: line.name,
              quantity: line.quantity,
              price: formatMoney(line.priceCents),
            })),
          },
        },
      });
      await tx.cartItem.deleteMany({ where: { userId } });
      await tx.cart.updateMany({
        where: { userId },
        data: { couponCode: null },
      });
      return order;
    });
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
