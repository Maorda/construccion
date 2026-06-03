import { Global, Module, DynamicModule, Provider, Inject } from '@nestjs/common';
import { DiscoveryModule, APP_INTERCEPTOR, ModuleRef } from '@nestjs/core';
import { HttpModule } from '@nestjs/axios';
import { CacheModule, CacheInterceptor } from '@nestjs/cache-manager';

// Servicios de Infraestructura y Configuración
import { GoogleAutenticarService } from '@sheetOdm/services/auth.google.service';
import { GoogleHealthService } from '@sheetOdm/services/google-health.service';
import { DatabaseConfigService } from '@sheetOdm/services/database-config.service';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { NamingStrategy } from '@sheetOdm/strategy/naming.strategy';
import { InfrastructureProvisioner } from '@sheetOdm/services/InfrastructureProvisioner.service';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { UnitOfWork } from '@sheetOdm/services/UnitOfWork';

// Motores de Datos, Hidratación y Relaciones
import { SheetsRepositoryFactory } from '@sheetOdm/repository/sheets-repository.factory';
import { ProjectionService } from '@sheetOdm/engines/projection.service';
import { AggregationEngine } from '@sheetOdm/engines/dependientesnivel1/aggregation.engine';
import { RelationManager } from '@sheetOdm/services/relation-manager.service';
import { DataMapper } from '@sheetOdm/services/data-mapper.service';
import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator';
import { SheetsRepositoryBuilder } from '@sheetOdm/repository/SheetsRepositoryBuilder';
import { TransformationEngine } from '@sheetOdm/engines/TransformationEngine';
import { ValidationEngine } from '@sheetOdm/engines/ValidationEngine';
import { HydrationEngine } from '@sheetOdm/engines/HydrationEngine';
import { QueryEngine } from '@sheetOdm/engines/query.engine';
import { ExpressionEngine } from '@sheetOdm/engines/independientes/expression.engine';

// Pipeline Stages (Agregaciones)
import { PipelineOrchestrator } from '@sheetOdm/pipelines/pipeline.registry';
import { AddFieldsStage, MatchStage, ProjectStage } from '@sheetOdm/pipelines/stages/filtrado_y_transformacion';
import { GroupStage, LookupStage, UnwindStage } from '@sheetOdm/pipelines/stages/Estructura_Compleja';
import { LimitStage, SkipStage, SortStage } from '@sheetOdm/pipelines/stages/orden_y_paginacion';

// Tipos e Interfaces
import { ClassType } from '@sheetOdm/types/query.types';
import { DatabaseModuleOptions, DatabaseModuleAsyncOptions, GoogleDriveConfig } from '@sheetOdm/interfaces/database.options.interface';
import { createModel } from '@sheetOdm/repository/create-model';

// =========================================================================
// UTILIDADES DE TOKENS (Exportar de manera pública en tu librería)
// =========================================================================
export const getModelToken = (entity: Function | string): string =>
    typeof entity === 'string' ? `${entity}Model` : `${entity.name}Model`;

export const getRepositoryToken = (entity: Function | string): string =>
    typeof entity === 'string' ? `${entity}Repository` : `${entity.name}Repository`;

export const InjectModel = (entity: Function) => Inject(getModelToken(entity));
export const InjectRepository = (entity: Function) => Inject(getRepositoryToken(entity));

// =========================================================================
// LISTA DE PROVEEDORES DEL CORE LOGICIAL
// =========================================================================
const CORE_PROVIDERS: Provider[] = [
    PipelineOrchestrator,
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
    ProjectionService,
    QueryEngine,
    AggregationEngine,
    ExpressionEngine,
    InfrastructureProvisioner,
    SheetDataGateway,
    RelationManager,
    DataMapper,
    SheetDocumentHydrator,
    UnitOfWork,
    TransformationEngine,
    ValidationEngine,
    HydrationEngine,
];

@Global()
@Module({
    imports: [
        HttpModule,
        DiscoveryModule,
        CacheModule.register({
            isGlobal: true,
            ttl: 60 * 60 * 1000, // 1 hora de caché por defecto
            max: 100,
        }),
    ],
})
export class OdmSheetModule {

    /**
     * Configuración global asíncrona de conexión, base de datos e inyección de tokens maestros.
     */
    static forRootAsync(options: DatabaseModuleAsyncOptions): DynamicModule {
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
     * Registra colecciones/entidades individuales acoplándolas a la arquitectura Active Record.
     */
    static forFeature(entities: ClassType[]): DynamicModule {
        const providers: Provider[] = entities.flatMap(Entity => {
            const MODEL_TOKEN = getModelToken(Entity);
            const REPO_TOKEN = getRepositoryToken(Entity);

            return [
                // 1. EL REPOSITORIO DE LA ENTIDAD
                {
                    provide: REPO_TOKEN,
                    useFactory: (
                        metadataRegistry: MetadataRegistry,
                        queryEngine: QueryEngine,
                        gateway: SheetDataGateway,
                        relationManager: RelationManager,
                        dataMapper: DataMapper,
                        moduleRef: ModuleRef,
                        hydrator: SheetDocumentHydrator,
                        unitOfWork: UnitOfWork
                    ) => {
                        return SheetsRepositoryBuilder.build(
                            Entity,
                            metadataRegistry,
                            queryEngine,
                            gateway,
                            relationManager,
                            dataMapper,
                            moduleRef,
                            hydrator,
                            unitOfWork
                        );
                    },
                    inject: [
                        MetadataRegistry,
                        QueryEngine,
                        SheetDataGateway,
                        RelationManager,
                        DataMapper,
                        ModuleRef,
                        SheetDocumentHydrator,
                        UnitOfWork
                    ],
                },

                // 2. EL MODELO DINÁMICO (ACTIVE RECORD CAPABILITIES)
                {
                    provide: MODEL_TOKEN,
                    useFactory: (repo: any) => createModel(Entity, repo),
                    inject: [REPO_TOKEN],
                },

                // 3. LA CLASE DE LA ENTIDAD COMO ALIAS INYECTABLE
                {
                    provide: Entity,
                    useFactory: (model: any) => model,
                    inject: [MODEL_TOKEN],
                },
            ];
        });

        return {
            module: OdmSheetModule,
            providers: providers,
            exports: providers, // Permite que el módulo consumidor exporte los modelos si lo requiere
        };
    }
}