import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SessionUser } from '../auth/session-user';
import { CartService } from './cart.service';
import type { CartJson, CouponAppliedJson } from './cart.presenter';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { ApplyCouponDto } from './dto/apply-coupon.dto';
import { PatchCartItemDto } from './dto/patch-cart-item.dto';

@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: SessionUser): Promise<CartJson> {
    return this.cart.get(user.id);
  }

  @Post('items')
  @HttpCode(201)
  addItem(
    @CurrentUser() user: SessionUser,
    @Body() body: AddCartItemDto,
  ): Promise<{ id: string }> {
    return this.cart.addItem(user.id, body.id, body.quantity ?? 1);
  }

  @Patch('items/:id')
  patchItem(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() body: PatchCartItemDto,
  ): Promise<{ id: string; quantity: number }> {
    return this.cart.patchItem(user.id, id, body.quantity);
  }

  @Delete('items/:id')
  @HttpCode(204)
  removeItem(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.cart.removeItem(user.id, id);
  }

  @Post('coupon')
  @HttpCode(200)
  applyCoupon(
    @CurrentUser() user: SessionUser,
    @Body() body: ApplyCouponDto,
  ): Promise<CouponAppliedJson> {
    return this.cart.applyCoupon(user.id, body.code);
  }
}
