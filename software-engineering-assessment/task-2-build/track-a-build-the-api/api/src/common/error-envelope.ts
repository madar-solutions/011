import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorEnvelope = {
  error: { code: string; message: string };
};

/** What we persist for a completed HTTP call — success body or ErrorEnvelope. */
export type StoredHttp = {
  statusCode: number;
  body: unknown;
};

export function errorEnvelope(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

export function isErrorEnvelope(
  payload: unknown,
): payload is ErrorEnvelope {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
    return false;
  }
  const error = (payload as { error: unknown }).error;
  return typeof error === 'object' && error !== null && 'message' in error;
}

export function storedHttpFromException(exception: unknown): StoredHttp {
  return toErrorEnvelope(exception);
}

export function toErrorEnvelope(exception: unknown): StoredHttp {
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    if (isErrorEnvelope(payload)) {
      return { statusCode, body: payload };
    }
    return {
      statusCode,
      body: errorEnvelope(codeFor(statusCode), messageOf(payload)),
    };
  }
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    body: errorEnvelope('INTERNAL', 'حدث خطأ غير متوقع.'),
  };
}

function codeFor(status: number): string {
  if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED';
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status === HttpStatus.BAD_REQUEST) return 'VALIDATION';
  if (status === HttpStatus.SERVICE_UNAVAILABLE) return 'UNAVAILABLE';
  return 'ERROR';
}

function messageOf(payload: string | object): string {
  if (typeof payload === 'string') return payload;
  const raw = (payload as { message?: string | string[] }).message;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return 'تعذّر إتمام الطلب.';
}
