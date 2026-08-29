import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../common/api.exception';
import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { AuthService } from './auth.service';
import type { SessionUser } from './session-user';

export type AuthedRequest = Request & {
  sessionUser?: SessionUser;
  sessionJti?: string;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = this.bearer(req.headers.authorization);
    if (!token) {
      throw this.denied();
    }

    const session = await this.auth.resolve(token);
    if (!session) {
      throw this.denied();
    }

    req.sessionUser = session.user;
    req.sessionJti = session.jti;
    return true;
  }

  private bearer(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    if (scheme !== 'Bearer' || !value) return null;
    return value;
  }

  private denied(): ApiException {
    return new ApiException(
      HttpStatus.UNAUTHORIZED,
      'UNAUTHORIZED',
      'يُرجى تسجيل الدخول مجددًا.',
    );
  }
}
