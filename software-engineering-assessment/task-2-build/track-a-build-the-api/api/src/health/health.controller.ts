import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  async health(): Promise<{ status: 'ok' }> {
    try {
      await Promise.all([this.prisma.ping(), this.redis.ping()]);
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok' };
  }
}
