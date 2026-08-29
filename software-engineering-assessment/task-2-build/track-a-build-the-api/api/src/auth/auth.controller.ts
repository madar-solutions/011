import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { AuthService } from './auth.service';
import type { AuthedRequest } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import type { SessionUser } from './session-user';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto): Promise<{ token: string; user: SessionUser }> {
    return this.auth.login(body.username, body.password);
  }

  @Get('session')
  session(@CurrentUser() user: SessionUser): { user: SessionUser } {
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AuthedRequest): Promise<Record<string, never>> {
    if (req.sessionJti) {
      await this.auth.logout(req.sessionJti);
    }
    return {};
  }
}
