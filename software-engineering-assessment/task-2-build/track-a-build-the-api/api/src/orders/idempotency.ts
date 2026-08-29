import {
  errorEnvelope,
  storedHttpFromException,
  type StoredHttp,
} from '../common/error-envelope';
import type { RedisService } from '../redis/redis.service';

export const IDEMPOTENCY_PENDING = 'pending';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseStoredHttp(raw: string | null): StoredHttp | 'pending' | null {
  if (!raw) return null;
  if (raw === IDEMPOTENCY_PENDING) return 'pending';
  try {
    const value = JSON.parse(raw) as StoredHttp;
    if (value && typeof value.statusCode === 'number' && 'body' in value) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

export async function withIdempotency(
  redis: RedisService,
  key: string,
  ttlSeconds: number,
  waitMs: number,
  work: () => Promise<StoredHttp>,
): Promise<StoredHttp> {
  const claimed = await redis.setIfAbsent(key, IDEMPOTENCY_PENDING, ttlSeconds);
  if (!claimed) {
    return waitForStored(redis, key, waitMs);
  }
  try {
    const result = await work();
    await redis.set(key, JSON.stringify(result), ttlSeconds);
    return result;
  } catch (error) {
    const stored = storedHttpFromException(error);
    await redis.set(key, JSON.stringify(stored), ttlSeconds);
    return stored;
  }
}

async function waitForStored(
  redis: RedisService,
  key: string,
  waitMs: number,
): Promise<StoredHttp> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const parsed = parseStoredHttp(await redis.get(key));
    if (parsed && parsed !== 'pending') return parsed;
    await sleep(100);
  }
  return {
    statusCode: 503,
    body: errorEnvelope('UNAVAILABLE', 'الطلب ما زال قيد المعالجة. حاول مرة أخرى.'),
  };
}
