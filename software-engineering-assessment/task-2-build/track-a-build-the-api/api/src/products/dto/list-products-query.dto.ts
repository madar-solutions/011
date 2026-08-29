import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListProductsQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsString({ message: 'قيمة البحث غير صالحة.' })
  @MaxLength(200, { message: 'قيمة البحث أطول من المسموح.' })
  q?: string;
}
