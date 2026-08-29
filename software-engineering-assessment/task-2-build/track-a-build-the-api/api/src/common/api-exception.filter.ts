import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { toErrorEnvelope } from './error-envelope';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (!(exception instanceof HttpException)) {
      this.log.error(exception instanceof Error ? exception.stack : exception);
    }
    const { statusCode, body } = toErrorEnvelope(exception);
    res.status(statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
