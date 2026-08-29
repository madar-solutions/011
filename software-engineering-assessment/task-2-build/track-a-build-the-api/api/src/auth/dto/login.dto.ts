import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsString({ message: 'اسم المستخدم مطلوب.' })
  @IsNotEmpty({ message: 'اسم المستخدم مطلوب.' })
  username!: string;

  @IsString({ message: 'كلمة المرور مطلوبة.' })
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة.' })
  password!: string;
}
