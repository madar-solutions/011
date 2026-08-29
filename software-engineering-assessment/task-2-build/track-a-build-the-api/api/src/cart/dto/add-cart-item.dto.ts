import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @IsString({ message: 'المنتج مطلوب.' })
  @IsNotEmpty({ message: 'المنتج مطلوب.' })
  id!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'الكمية غير صالحة.' })
  @Min(1, { message: 'الكمية غير صالحة.' })
  @Max(999, { message: 'الكمية غير صالحة.' })
  quantity?: number;
}
