import { Global, Module, DynamicModule, Provider } from '@nestjs/common';
import { DiscoveryModule, APP_INTERCEPTOR, ModuleRef } from '@nestjs/core';
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
import { QueryEngine } from '@sheetOdm/pipelines/query.engine';

// Tipos, Creador de Modelos y Opciones
import { ClassType } from '@sheetOdm/types/query.types';
import { DatabaseModuleOptions, DatabaseModuleAsyncOptions, GoogleDriveConfig } from '@sheetOdm/interfaces/database.options.interface';
import { createModel } from '@sheetOdm/repository/create-model';
import { InfrastructureProvisioner } from './services/InfrastructureProvisioner.service';
import { SheetDataGateway } from './gateway/sheetDataGateway';
import { RelationManager } from './services/relation-manager.service';
import { DataMapper } from './services/data-mapper.service';
import { SheetDocumentHydrator } from './core/base/SheetDocumentHydrator';

import { MatchStage, SortStage } from './engines/query/match_sort_pagination';
import { ProjectStage } from './engines/query/projection';
import { AddFieldsStage } from './pipelines/stages/add-fields.stage';
import { GroupStage } from './pipelines/stages/group.stage';
import { LimitStage } from './pipelines/stages/limit.stage';
import { SkipStage } from './pipelines/stages/skip.stage';
import { UnwindStage } from './pipelines/stages/unwind.stage';
import { LookupStage } from './pipelines/stages/lookup.stage';
import { SheetsRepositoryBuilder } from './repository/SheetsRepositoryBuilder';

const CORE_PROVIDERS: Provider[] = [

    MatchStage,
    ProjectStage,
    LookupStage,
    SortStage,
    GroupStage,
    UnwindStage,
    AddFieldsStage,
    LimitStage,
    SkipStage,
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
    SheetDocumentHydrator,
    ProjectionService,

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
                    useFactory: <T extends Object>(
                        entityClass: ClassType,
                        metadataRegistry: MetadataRegistry,
                        queryEngine: QueryEngine<T>,
                        gateway: SheetDataGateway,
                        relationManager: RelationManager,
                        dataMapper: DataMapper,
                        moduleRef: ModuleRef,
                        hydrator: SheetDocumentHydrator,) => {
                        // Llamas a tu builder limpio
                        return SheetsRepositoryBuilder.build(
                            entityClass,
                            metadataRegistry,
                            queryEngine,
                            gateway,
                            relationManager,
                            dataMapper,
                            moduleRef,
                            hydrator
                        );
                    },
                    inject: [GoogleAutenticarService,
                        MetadataRegistry,
                        QueryEngine,
                        'DATABASE_OPTIONS', // Importante: usar el token string
                        SheetDataGateway,
                        RelationManager,
                        DataMapper,
                        ModuleRef
                    ],
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
