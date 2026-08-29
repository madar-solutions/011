import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

export class ApplyCouponDto {
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return value.trim();
  })
  @IsString({ message: 'رمز الخصم غير صالح.' })
  @MaxLength(64, { message: 'رمز الخصم غير صالح.' })
  code!: string;
}
