import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { envValidationSchema } from '../env.validation.js';
import { OdmSheetModule } from '@sheetOdm/odm-sheet.module.js';
import { CONNECTION_STABILITY } from '@sheetOdm/interfaces/database.options.interface.js';
import { PlanillaModule } from './planilla/planilla.module.js';
import { ModuleRef } from '@nestjs/core';
import { InfrastructureProvisioner } from '@sheetOdm/services/InfrastructureProvisioner.service.js';
import { configLoader } from '../configLoader.js';
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configLoader],
      validationSchema: envValidationSchema,
      isGlobal: true,
      envFilePath: '.env',
    }),
    OdmSheetModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        googleDriveConfig: {
          type: 'service_account',
          project_id: config.get<string>('GOOGLE_PROJECT_ID')!,
          private_key_id: config.get<string>('GOOGLE_PRIVATE_KEY_ID')!,
          private_key: (config.get<string>('GOOGLE_PRIVATE_KEY') || '').replace(/\\n/g, '\n'),
          client_email: config.get<string>('GOOGLE_CLIENT_EMAIL')!,
          client_id: config.get<string>('GOOGLE_CLIENT_ID')!,
          auth_uri: config.get<string>('GOOGLE_AUTH_URI')!,
          token_uri: config.get<string>('GOOGLE_TOKEN_URI')!,
          auth_provider_x509_cert_url: config.get<string>('GOOGLE_AUTH_PROVIDER_X509_CERT_URL')!,
          client_x509_cert_url: config.get<string>('GOOGLE_CLIENT_X509_CERT_URL')!,
        },
        googleDriveBaseFolderId: config.get<string>('GOOGLE_FOLDER_ID')!,
        SPREADSHEET_ID: config.get<string>('SPREADSHEET_ID')!,
        checkConnectionOnBoot: true,
        timezone: config.get<string>('TIMEZONE') || 'UTC',//'America/Lima configurado en el .env',
        FORMAT_DATES: config.get<boolean>('FORMAT_DATES') || false, //configurado en el .env
        timeout: CONNECTION_STABILITY.UNSTABLE,
        outboxPollingInterval: 10000,
      }),
    }),

    PlanillaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('DebugModuloPrincipal');

  constructor(private readonly moduleRef: ModuleRef) { }

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.logger.log('--- 🚀 INICIANDO SINCRONIZACIÓN DE INFRAESTRUCTURA ---');

    try {
      const provisioner = this.moduleRef.get(InfrastructureProvisioner, { strict: false });
      await provisioner.syncSchema();

    } catch (error) {
      this.logger.error('❌ Error crítico en la inicialización:', error.message);
    }

    this.logger.log('--- ✅ INFRAESTRUCTURA LISTA ---');
  }

}
