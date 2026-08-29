import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SessionUser } from '../auth/session-user';
import { ApiException } from '../common/api.exception';
import { CreateOrderDto } from './dto/create-order.dto';
import type { OrderDetailJson, OrderListItemJson } from './order.presenter';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(
    @CurrentUser() user: SessionUser,
  ): Promise<{ items: OrderListItemJson[] }> {
    return this.orders.list(user.id);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<OrderDetailJson> {
    return this.orders.getById(user.id, id);
  }

  @Post()
  async create(
    @CurrentUser() user: SessionUser,
    @Body() body: CreateOrderDto,
    @Headers('x-request-id') requestId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const id = requestId?.trim();
    if (!id) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION',
        'معرّف الطلب مطلوب.',
      );
    }
    const result = await this.orders.place(user.id, id, body.card);
    res.status(result.statusCode).json(result.body);
  }
}
