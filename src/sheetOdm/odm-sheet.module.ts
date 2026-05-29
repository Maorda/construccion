import { Global, Module, DynamicModule, Provider } from '@nestjs/common';
import { DiscoveryModule, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpModule } from '@nestjs/axios';
import { CacheModule, CacheInterceptor } from '@nestjs/cache-manager';

import { GoogleAutenticarService } from '@sheetOdm/services/auth.google.service';
import { GoogleHealthService } from '@sheetOdm/services/google-health.service';
import { DatabaseConfigService } from '@sheetOdm/services/database-config.service';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { NamingStrategy } from '@sheetOdm/strategy/naming.strategy';
import { SheetsRepositoryFactory } from '@sheetOdm/repository/sheets-repository.factory';

// Motores de Consulta
import { CompareEngine } from '@sheetOdm/engines/compare.engine';
import { ExpressionEngine } from '@sheetOdm/engines/expression.engine';
import { ProjectionService } from '@sheetOdm/engines/projection.service';
import { AggregationEngine } from '@sheetOdm/engines/aggregation.engine';
import { QueryEngine } from '@sheetOdm/engines/query.engine';

// Tipos, Creador de Modelos y Opciones
import { ClassType } from '@sheetOdm/types/query.types';
import { DatabaseModuleOptions, DatabaseModuleAsyncOptions, GoogleDriveConfig } from '@sheetOdm/interfaces/database.options.interface';
import { createModel } from '@sheetOdm/repository/create-model';
import { InfrastructureProvisioner } from './services/InfrastructureProvisioner.service';
import { SheetDataGateway } from './gateway/sheetDataGateway';
import { SheetsRepository } from './repository/sheets.repository';
import { RelationManager } from './services/relation-manager.service';
import { DataMapper } from './services/data-mapper.service';
import { SheetDocumentHydrator } from './core/base/SheetDocumentHydrator';

const CORE_PROVIDERS: Provider[] = [
    GoogleAutenticarService,
    GoogleHealthService,
    DatabaseConfigService,
    MetadataRegistry,
    NamingStrategy,
    SheetsRepositoryFactory,
    //SheetsRepository, nunca se pone
    ProjectionService,
    QueryEngine,
    CompareEngine,
    AggregationEngine,
    ExpressionEngine,
    InfrastructureProvisioner,
    SheetDataGateway,
    RelationManager,
    DataMapper,
    SheetDocumentHydrator
];

@Global()
@Module({
    imports: [
        HttpModule,
        DiscoveryModule,
        CacheModule.register({
            isGlobal: true,
            ttl: 60 * 60 * 1000, // 1 hora de cache
            max: 100,
        }),
    ],
    //providers: [InfrastructureProvisioner, MetadataRegistry, SheetDataGateway],
    //exports: [InfrastructureProvisioner]
})
export class OdmSheetModule {
    /**
     * registerAsync: Configuración global asíncrona de conexión y credenciales de Google
     */
    static registerAsync(options: DatabaseModuleAsyncOptions): DynamicModule {
        const spreadsheetIdProvider: Provider = {
            provide: 'SPREADSHEET_ID',
            useFactory: (opts: DatabaseModuleOptions) => opts.SPREADSHEET_ID,
            inject: ['DATABASE_OPTIONS'],
        };

        const optionsProvider: Provider = {
            provide: 'DATABASE_OPTIONS',
            useFactory: options.useFactory!,
            inject: options.inject || [],
        };

        const configProvider: Provider = {
            provide: 'CONFIG',
            useFactory: (opts: DatabaseModuleOptions): GoogleDriveConfig => opts.googleDriveConfig,
            inject: ['DATABASE_OPTIONS'],
        };

        const folderIdProvider: Provider = {
            provide: 'FOLDERID',
            useFactory: (opts: DatabaseModuleOptions) => opts.googleDriveBaseFolderId,
            inject: ['DATABASE_OPTIONS'],
        };

        return {
            module: OdmSheetModule,
            providers: [
                optionsProvider,
                configProvider,
                folderIdProvider,
                spreadsheetIdProvider,
                ...CORE_PROVIDERS,
                {
                    provide: APP_INTERCEPTOR,
                    useClass: CacheInterceptor,
                },
            ],
            exports: ['DATABASE_OPTIONS', 'CONFIG', 'FOLDERID', ...CORE_PROVIDERS],
        };
    }

    /**
     * forFeature: Registra los repositorios y modelos de forma automatizada para cada clase de entidad.
     */
    static forFeature(entities: ClassType[]): DynamicModule {
        const providers: Provider[] = entities.flatMap(Entity => {
            const MODEL_TOKEN = `${Entity.name}Model`;
            const REPO_TOKEN = `${Entity.name}Repository`;

            return [
                // 1. EL REPOSITORIO: Delegamos el instanciamiento a la fábrica
                {
                    provide: REPO_TOKEN,
                    useFactory: (factory: SheetsRepositoryFactory) => factory.create(Entity),
                    inject: [SheetsRepositoryFactory],
                },
                // 2. EL MODELO: Construido dinámicamente con el wrap Active Record
                {
                    provide: MODEL_TOKEN,
                    useFactory: (repo: any) => createModel(Entity, repo),
                    inject: [REPO_TOKEN],
                },
                // 3. LA CLASE: Alias inyectable para usar el tipo directo de la entidad (ej: constructor(private obrero: ObreroEntity))
                {
                    provide: Entity,
                    useFactory: (model: any) => model,
                    inject: [MODEL_TOKEN],
                },
            ];
        });

        return {
            module: OdmSheetModule,
            providers: [...providers],
            exports: [...providers],
        };
    }
}
