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
import {
  errorEnvelope,
  storedHttpFromException,
  type StoredHttp,
} from '../common/error-envelope';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  CLAIMED,
  parseIdempotency,
  processingUnavailable,
  sleep,
  type CheckoutSnapshot,
  type SnapshotLine,
} from './idempotency';
import {
  toOrderDetail,
  toOrderListItem,
  type OrderDetailJson,
  type OrderListItemJson,
} from './order.presenter';
import { chargeCard, lookupCharge, type ChargeCard } from './payments.client';

type Tx = Prisma.TransactionClient;

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
    const waitMs = timeoutMs + 5_000;
    const key = `idempotency:${userId}:${requestId}`;
    const claimed = await this.redis.setIfAbsent(key, CLAIMED, ttlSeconds);
    if (!claimed) {
      return this.resumeOrWait(userId, key, requestId, ttlSeconds, waitMs);
    }
    try {
      const result = await this.checkout(
        userId,
        requestId,
        card,
        timeoutMs,
        key,
        ttlSeconds,
      );
      if (this.shouldPersistOutcome(result, await this.redis.get(key))) {
        await this.redis.set(key, JSON.stringify(result), ttlSeconds);
      }
      return result;
    } catch (error) {
      const parsed = parseIdempotency(await this.redis.get(key));
      if (parsed && 'kind' in parsed && parsed.kind === 'charged') {
        return storedHttpFromException(error);
      }
      if (parsed && 'kind' in parsed && parsed.kind === 'reserved') {
        const settled = await this.reconcileCharge(requestId, parsed.snapshot);
        if (settled.kind === 'committed') {
          await this.redis.set(
            key,
            JSON.stringify(settled.http),
            ttlSeconds,
          );
          return settled.http;
        }
        if (settled.kind === 'unknown') {
          return storedHttpFromException(error);
        }
      }
      const stored = storedHttpFromException(error);
      await this.redis.set(key, JSON.stringify(stored), ttlSeconds);
      return stored;
    }
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
      where: { id, userId, status: 'paid' },
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

  private async resumeOrWait(
    userId: string,
    key: string,
    requestId: string,
    ttlSeconds: number,
    waitMs: number,
  ): Promise<StoredHttp> {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const parsed = parseIdempotency(await this.redis.get(key));
      if (parsed && 'statusCode' in parsed) return parsed;
      if (parsed && parsed.kind === 'charged') {
        const stored = await this.finishCharged(
          requestId,
          parsed.snapshot,
          parsed.chargeId,
        );
        await this.redis.set(key, JSON.stringify(stored), ttlSeconds);
        return stored;
      }
      await sleep(100);
    }

    const parsed = parseIdempotency(await this.redis.get(key));
    if (parsed && 'statusCode' in parsed) return parsed;
    if (parsed && parsed.kind === 'charged') {
      const stored = await this.finishCharged(
        requestId,
        parsed.snapshot,
        parsed.chargeId,
      );
      await this.redis.set(key, JSON.stringify(stored), ttlSeconds);
      return stored;
    }
    if (parsed && parsed.kind === 'reserved') {
      const settled = await this.reconcileCharge(requestId, parsed.snapshot);
      if (settled.kind === 'committed') {
        await this.redis.set(key, JSON.stringify(settled.http), ttlSeconds);
        return settled.http;
      }
      if (settled.kind === 'unknown') return processingUnavailable();
      const stored = processingUnavailable();
      await this.redis.set(key, JSON.stringify(stored), ttlSeconds);
      return stored;
    }
    if (parsed && parsed.kind === 'claimed') {
      await this.abandonPendingIfAny(userId, requestId);
    }
    const stored = processingUnavailable();
    await this.redis.set(key, JSON.stringify(stored), ttlSeconds);
    return stored;
  }

  private async checkout(
    userId: string,
    requestId: string,
    card: ChargeCard,
    timeoutMs: number,
    key: string,
    ttlSeconds: number,
  ): Promise<StoredHttp> {
    const snapshot = await this.claimCart(userId, requestId);
    await this.redis.set(
      key,
      JSON.stringify({ kind: 'reserved', snapshot }),
      ttlSeconds,
    );
    let charged = false;
    try {
      const charge = await chargeCard({
        url: this.config.getOrThrow<string>('PAYMENTS_URL'),
        timeoutMs,
        amount: formatMoney(snapshot.totalCents),
        card,
        reference: requestId,
      });
      if (charge.kind === 'declined') {
        await this.abandonReservation(requestId, snapshot);
        return {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          body: errorEnvelope('CARD_DECLINED', 'عذرًا، رُفضت البطاقة.'),
        };
      }
      if (charge.kind === 'unavailable') {
        const settled = await this.reconcileCharge(requestId, snapshot);
        if (settled.kind === 'committed') return settled.http;
        if (settled.kind === 'unknown') return processingUnavailable();
        return {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          body: errorEnvelope(
            'UNAVAILABLE',
            'تعذّر الاتصال ببوابة الدفع. حاول مرة أخرى.',
          ),
        };
      }
      charged = true;
      await this.redis.set(
        key,
        JSON.stringify({
          kind: 'charged',
          snapshot,
          chargeId: charge.chargeId,
        }),
        ttlSeconds,
      );
      return this.finishCharged(requestId, snapshot, charge.chargeId);
    } catch (error) {
      if (!charged) {
        const settled = await this.reconcileCharge(requestId, snapshot);
        if (settled.kind === 'committed') return settled.http;
        if (settled.kind === 'unknown') throw error;
      }
      throw error;
    }
  }

  private async finishCharged(
    requestId: string,
    snapshot: CheckoutSnapshot,
    chargeId: string,
  ): Promise<StoredHttp> {
    const order = await this.commitPaid(snapshot, requestId, chargeId);
    return { statusCode: HttpStatus.CREATED, body: toOrderListItem(order) };
  }

  private async claimCart(
    userId: string,
    requestId: string,
  ): Promise<CheckoutSnapshot> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ user_id: string }>>`
        SELECT user_id FROM carts WHERE user_id = ${userId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION',
          'السلة فارغة.',
        );
      }

      const cart = await tx.cart.findUnique({
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

      if (cart.coupon) {
        await tx.$queryRaw`
          SELECT 1 FROM coupons WHERE code = ${cart.coupon.code} FOR UPDATE
        `;
        const redemptions = await this.redemptionsTx(
          tx,
          userId,
          cart.coupon.code,
          true,
        );
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
      );

      const lines: SnapshotLine[] = cart.items.map((item) => ({
        productId: item.productId,
        name: item.product.name,
        quantity: item.quantity,
        priceCents: toCents(item.product.price),
      }));

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

      await tx.order.create({
        data: {
          id: `o_${randomUUID()}`,
          userId,
          status: 'pending',
          total: formatMoney(totals.totalCents),
          couponCode: cart.couponCode,
          requestId,
          items: {
            create: lines.map((line) => ({
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
      await tx.cart.update({
        where: { userId },
        data: { couponCode: null },
      });

      return {
        userId,
        lines,
        totalCents: totals.totalCents,
        couponCode: cart.couponCode,
      };
    });
  }

  private async commitPaid(
    snapshot: CheckoutSnapshot,
    requestId: string,
    chargeId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({
        where: {
          userId_requestId: { userId: snapshot.userId, requestId },
        },
      });
      if (existing?.status === 'paid') return existing;

      if (snapshot.couponCode) {
        await tx.$queryRaw`
          SELECT 1 FROM coupons WHERE code = ${snapshot.couponCode} FOR UPDATE
        `;
        const coupon = await tx.coupon.findUnique({
          where: { code: snapshot.couponCode },
        });
        if (!coupon) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            'COUPON_NOT_FOUND',
            'كود الخصم غير صالح.',
          );
        }
        const redemptions = await this.redemptionsTx(
          tx,
          snapshot.userId,
          coupon.code,
          false,
        );
        const subtotalCents = snapshot.lines.reduce(
          (sum, line) => sum + line.priceCents * line.quantity,
          0,
        );
        const usable = couponDiscount(
          this.toCouponInput(coupon),
          subtotalCents,
          new Date(),
          redemptions,
        );
        if (!usable.ok) throw this.couponException(usable.reason);
      }

      if (existing?.status === 'pending') {
        return tx.order.update({
          where: { id: existing.id },
          data: { status: 'paid', chargeId },
        });
      }

      return tx.order.create({
        data: {
          id: `o_${randomUUID()}`,
          userId: snapshot.userId,
          status: 'paid',
          total: formatMoney(snapshot.totalCents),
          couponCode: snapshot.couponCode,
          chargeId,
          requestId,
          items: {
            create: snapshot.lines.map((line) => ({
              id: randomUUID(),
              productId: line.productId,
              name: line.name,
              quantity: line.quantity,
              price: formatMoney(line.priceCents),
            })),
          },
        },
      });
    });
  }

  private async abandonPendingIfAny(
    userId: string,
    requestId: string,
  ): Promise<void> {
    const existing = await this.prisma.order.findUnique({
      where: { userId_requestId: { userId, requestId } },
      include: { items: true },
    });
    if (!existing || existing.status !== 'pending') return;
    await this.abandonReservation(requestId, {
      userId,
      lines: existing.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        priceCents: toCents(item.price),
      })),
      totalCents: toCents(existing.total),
      couponCode: existing.couponCode,
    });
  }

  private shouldPersistOutcome(result: StoredHttp, raw: string | null): boolean {
    if (result.statusCode !== HttpStatus.SERVICE_UNAVAILABLE) return true;
    const parsed = parseIdempotency(raw);
    return !(parsed && 'kind' in parsed && parsed.kind === 'reserved');
  }

  private async reconcileCharge(
    requestId: string,
    snapshot: CheckoutSnapshot,
  ): Promise<
    | { kind: 'committed'; http: StoredHttp }
    | { kind: 'abandoned' }
    | { kind: 'unknown' }
  > {
    const found = await lookupCharge({
      url: this.config.getOrThrow<string>('PAYMENTS_URL'),
      reference: requestId,
    });
    if (found.kind === 'unknown') return { kind: 'unknown' };
    if (found.kind === 'approved') {
      const http = await this.finishCharged(
        requestId,
        snapshot,
        found.chargeId,
      );
      return { kind: 'committed', http };
    }
    await this.abandonReservation(requestId, snapshot);
    return { kind: 'abandoned' };
  }

  private async abandonReservation(
    requestId: string,
    snapshot: CheckoutSnapshot,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({
        where: {
          userId_requestId: { userId: snapshot.userId, requestId },
        },
      });
      if (!existing || existing.status !== 'pending') return;
      await tx.order.delete({ where: { id: existing.id } });
      for (const line of snapshot.lines) {
        await tx.product.update({
          where: { id: line.productId },
          data: { stock: { increment: line.quantity } },
        });
      }
      await tx.cart.upsert({
        where: { userId: snapshot.userId },
        create: {
          userId: snapshot.userId,
          couponCode: snapshot.couponCode,
        },
        update: { couponCode: snapshot.couponCode },
      });
      for (const line of snapshot.lines) {
        await tx.cartItem.upsert({
          where: {
            userId_productId: {
              userId: snapshot.userId,
              productId: line.productId,
            },
          },
          create: {
            id: `ci_${randomUUID()}`,
            userId: snapshot.userId,
            productId: line.productId,
            quantity: line.quantity,
          },
          update: { quantity: line.quantity },
        });
      }
    });
  }

  private async redemptionsTx(
    tx: Tx,
    userId: string,
    couponCode: string,
    includePending: boolean,
  ): Promise<{ global: number; user: number }> {
    const status = includePending
      ? { in: ['paid', 'pending'] }
      : { equals: 'paid' };
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
