import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'اسم المستخدم مطلوب.' })
  @IsNotEmpty({ message: 'اسم المستخدم مطلوب.' })
  @MaxLength(64, { message: 'اسم المستخدم غير صالح.' })
  username!: string;

  @IsString({ message: 'كلمة المرور مطلوبة.' })
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة.' })
  @MaxLength(128, { message: 'كلمة المرور غير صالحة.' })
  password!: string;
}
