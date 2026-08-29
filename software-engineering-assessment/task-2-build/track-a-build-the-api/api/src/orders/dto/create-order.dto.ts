import { Type } from 'class-transformer';
import { IsDefined, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class ChargeCardDto {
  @IsString({ message: 'بيانات البطاقة غير مكتملة.' })
  @IsNotEmpty({ message: 'بيانات البطاقة غير مكتملة.' })
  name!: string;

  @IsString({ message: 'بيانات البطاقة غير مكتملة.' })
  @IsNotEmpty({ message: 'بيانات البطاقة غير مكتملة.' })
  number!: string;

  @IsString({ message: 'بيانات البطاقة غير مكتملة.' })
  @IsNotEmpty({ message: 'بيانات البطاقة غير مكتملة.' })
  expiry!: string;

  @IsString({ message: 'بيانات البطاقة غير مكتملة.' })
  @IsNotEmpty({ message: 'بيانات البطاقة غير مكتملة.' })
  cvc!: string;
}

export class CreateOrderDto {
  @IsDefined({ message: 'بيانات البطاقة غير مكتملة.' })
  @ValidateNested()
  @Type(() => ChargeCardDto)
  card!: ChargeCardDto;
}
