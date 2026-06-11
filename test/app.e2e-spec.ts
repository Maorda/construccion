process.env.NODE_ENV = 'test';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { InfrastructureProvisioner } from '../src/sheetOdm/services/InfrastructureProvisioner.service';


import { DATA_TRANSFORM_OPERATOR, FILTER_OPERATOR, PIPELINE_STAGE } from '../src/sheetOdm/pipelines/pipeline.constants';
import { DatabaseConfigService } from '../src/sheetOdm/services/database-config.service';
import { OutboxProcessor } from '../src/sheetOdm/core/outbox/OutboxProcessor';
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // 1. Mockeamos los tokens de configuración multi-provider
      .overrideProvider(PIPELINE_STAGE).useValue([])
      .overrideProvider(FILTER_OPERATOR).useValue([])
      .overrideProvider(DATA_TRANSFORM_OPERATOR).useValue([])

      // 2. Mockeamos servicios críticos de infraestructura
      .overrideProvider(OutboxProcessor).useValue({
        processPendingOperations: jest.fn().mockResolvedValue(undefined),
        onModuleDestroy: jest.fn(),
      })
      .overrideProvider(DatabaseConfigService).useValue({
        syncDatabaseSchema: jest.fn().mockResolvedValue(undefined)
      })
      .overrideProvider(InfrastructureProvisioner).useValue({
        syncSchema: jest.fn().mockResolvedValue(undefined)
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    // Esto disparará onModuleDestroy en todos los providers
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
