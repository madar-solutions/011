import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from './session-user';

type AuthedRequest = Request & { sessionUser?: SessionUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().sessionUser;
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  },
);
