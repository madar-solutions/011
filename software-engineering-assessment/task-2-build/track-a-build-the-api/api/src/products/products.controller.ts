import { Controller, Get, Param, Query } from '@nestjs/common';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductsService } from './products.service';
import type { ProductJson } from './product.presenter';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @Query() query: ListProductsQueryDto,
  ): Promise<{ items: ProductJson[] }> {
    return this.products.list(query.q);
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<ProductJson> {
    return this.products.getById(id);
  }
}
