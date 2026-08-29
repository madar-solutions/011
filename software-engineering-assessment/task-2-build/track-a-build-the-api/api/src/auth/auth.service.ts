import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { ApiException } from '../common/api.exception';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { SessionUser } from './session-user';

type JwtClaims = { sub: string; jti: string };

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash('__timing_pad__', 10);
  }

  async login(
    username: string,
    password: string,
  ): Promise<{ token: string; user: SessionUser }> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    const ok = await compare(password, user?.passwordHash ?? this.dummyHash);
    if (!user || !ok) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'اسم المستخدم أو كلمة المرور غير صحيحة.',
      );
    }

    const sessionUser: SessionUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    };
    const ttl = this.ttlSeconds();
    const jti = await this.claimSession(sessionUser, ttl);
    const token = await this.jwt.signAsync({ sub: user.id, jti } satisfies JwtClaims);

    return { token, user: sessionUser };
  }

  async resolve(token: string): Promise<{ user: SessionUser; jti: string } | null> {
    let claims: JwtClaims;
    try {
      claims = await this.jwt.verifyAsync<JwtClaims>(token);
    } catch {
      return null;
    }
    if (!claims.jti || !claims.sub) return null;

    const raw = await this.redis.get(this.key(claims.jti));
    if (!raw) return null;

    const user = JSON.parse(raw) as SessionUser;
    if (user.id !== claims.sub) return null;
    return { user, jti: claims.jti };
  }

  async logout(jti: string): Promise<void> {
    await this.redis.del(this.key(jti));
  }

  private async claimSession(
    sessionUser: SessionUser,
    ttl: number,
  ): Promise<string> {
    const payload = JSON.stringify(sessionUser);
    for (let i = 0; i < 3; i++) {
      const jti = randomUUID();
      const claimed = await this.redis.setIfAbsent(this.key(jti), payload, ttl);
      if (claimed) return jti;
    }
    throw new ApiException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL',
      'حدث خطأ غير متوقع.',
    );
  }

  private ttlSeconds(): number {
    return Number(this.config.get('SESSION_TTL_SECONDS') ?? 86400);
  }

  private key(jti: string): string {
    return `session:${jti}`;
  }
}
