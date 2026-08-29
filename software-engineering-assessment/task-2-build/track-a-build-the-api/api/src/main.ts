import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`listening on 0.0.0.0:${port}`, 'Bootstrap');
}

bootstrap();
