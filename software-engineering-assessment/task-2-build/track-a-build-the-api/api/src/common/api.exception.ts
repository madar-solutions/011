import { HttpException, HttpStatus } from '@nestjs/common';
import { errorEnvelope, type ErrorEnvelope } from './error-envelope';

export class ApiException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super(errorEnvelope(code, message) satisfies ErrorEnvelope, status);
  }
}
