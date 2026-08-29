import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PatchCartItemDto {
  @Type(() => Number)
  @IsInt({ message: 'الكمية غير صالحة.' })
  @Min(1, { message: 'الكمية غير صالحة.' })
  @Max(999, { message: 'الكمية غير صالحة.' })
  quantity!: number;
}
