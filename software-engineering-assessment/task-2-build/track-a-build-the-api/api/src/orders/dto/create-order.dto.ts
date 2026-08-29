import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  compactExpiry,
  digitsOnly,
  IsCardExpiry,
} from '../card.input';

function digits({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? digitsOnly(value) : value;
}

export class ChargeCardDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'الاسم على البطاقة مطلوب.' })
  @IsNotEmpty({ message: 'الاسم على البطاقة مطلوب.' })
  @MaxLength(80, { message: 'الاسم على البطاقة غير صالح.' })
  name!: string;

  @Transform(digits)
  @Matches(/^\d{16}$/, { message: 'رقم البطاقة يجب أن يتكوّن من 16 رقمًا.' })
  number!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? compactExpiry(value) : value,
  )
  @IsCardExpiry({ message: 'تاريخ انتهاء البطاقة غير صالح.' })
  expiry!: string;

  @Transform(digits)
  @Matches(/^\d{3,4}$/, {
    message: 'رمز الأمان يجب أن يتكوّن من 3 أو 4 أرقام.',
  })
  cvc!: string;
}

export class CreateOrderDto {
  @IsDefined({ message: 'بيانات البطاقة غير مكتملة.' })
  @ValidateNested()
  @Type(() => ChargeCardDto)
  card!: ChargeCardDto;
}
