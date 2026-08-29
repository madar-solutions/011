import { registerDecorator, type ValidationOptions } from 'class-validator';

const EXPIRY = /^(0[1-9]|1[0-2])\/(\d{2})$/;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function compactExpiry(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

export function isSixteenDigitPan(value: string): boolean {
  return /^\d{16}$/.test(value);
}

export function isCvc(value: string): boolean {
  return /^\d{3,4}$/.test(value);
}

/** Valid through the last day of the expiry month (MM/YY). */
export function isValidCardExpiry(
  value: string,
  now: Date = new Date(),
): boolean {
  const match = EXPIRY.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  const expiresAt = new Date(year, month, 0, 23, 59, 59, 999);
  return expiresAt.getTime() >= now.getTime();
}

export function IsCardExpiry(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isCardExpiry',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidCardExpiry(value);
        },
        defaultMessage() {
          return 'تاريخ انتهاء البطاقة غير صالح.';
        },
      },
    });
  };
}
