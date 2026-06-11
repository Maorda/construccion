import { Global, Module, DynamicModule, Provider, Inject, ClassProvider } from '@nestjs/common';
import { DiscoveryModule, APP_INTERCEPTOR, ModuleRef } from '@nestjs/core';
import { HttpModule } from '@nestjs/axios';
import { CacheModule, CacheInterceptor } from '@nestjs/cache-manager';

// Servicios de Infraestructura y Configuración
import { GoogleAutenticarService } from '@sheetOdm/services/auth.google.service.js';
import { GoogleHealthService } from '@sheetOdm/services/google-health.service.js';
import { DatabaseConfigService } from '@sheetOdm/services/database-config.service.js';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service.js';
import { NamingStrategy } from '@sheetOdm/strategy/naming.strategy.js';
import { InfrastructureProvisioner } from '@sheetOdm/services/InfrastructureProvisioner.service.js';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway.js';
import { UnitOfWork } from '@sheetOdm/services/UnitOfWork.js';

// Motores de Datos, Hidratación y Relaciones
import { SheetsRepositoryFactory } from '@sheetOdm/repository/sheets-repository.factory.js';
import { ProjectionService } from '@sheetOdm/engines/projection.service.js';

import { RelationManager } from '@sheetOdm/services/relation-manager.service.js';
import { DataMapper } from '@sheetOdm/services/data-mapper.service.js';
import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator.js';

import { TransformationEngine } from '@sheetOdm/engines/TransformationEngine.js';
import { ValidationEngine } from '@sheetOdm/engines/ValidationEngine.js';

import { QueryEngine } from '@sheetOdm/engines/query.engine.js';
import { ExpressionEngine } from '@sheetOdm/pipelines/expression.engine.js';

// Pipeline Stages (Agregaciones)
import { PipelineOrchestrator } from '@sheetOdm/pipelines/pipeline.registry.js';
import { AddFieldsStage, MatchStage, ProjectStage } from '@sheetOdm/pipelines/stages/filtrado_y_transformacion.js';
import { GroupStage, LookupStage, UnwindStage } from '@sheetOdm/pipelines/stages/Estructura_Compleja.js';
import { LimitStage, SkipStage, SortStage } from '@sheetOdm/pipelines/stages/orden_y_paginacion.js';

// Tipos e Interfaces
import { ClassType } from '@sheetOdm/types/query.types.js';
import { DatabaseModuleOptions, DatabaseModuleAsyncOptions, GoogleDriveConfig } from '@sheetOdm/interfaces/database.options.interface.js';
import { createModel } from '@sheetOdm/repository/create-model.js';
import { AggregationBuilder } from './pipelines/aggregation.builder.js';
import { DATA_TRANSFORM_OPERATOR, FILTER_OPERATOR, PIPELINE_STAGE } from './pipelines/pipeline.constants.js';
import { EqOperator, NeOperator, GtOperator, GteOperator, LtOperator, LteOperator, InOperator, NinOperator, ExistsOperator, RegexOperator } from './pipelines/operadores/filter.operators.js';
import { IfOperator, MultiplyOperator, IncOperator, MinMaxOperator, RoundOperator, MathOperator, UpperOperator, TrimOperator, ConcatOperator, DateAddOperator, TimeDiffOperator, AggregateOperator } from './pipelines/operadores/transform.operators.js';
import { GasService } from './core/base/services/gas.service.js';
import { TransactionInterceptor } from './core/interceptors/TransactionInterceptor.js';

import { OutboxModule } from './core/outbox/outbox.module.js';
import { SheetDataTransformer } from './core/base/sheetDataTransformer.js';
import { MutationEngine } from './engines/mutationEngine.js';
import { WalManagerService } from './services/wal-manager.service.js';

// =========================================================================
// UTILIDADES DE TOKENS (Exportar de manera pública en tu librería)
// =========================================================================
export const getModelToken = (entity: ClassType | string): string =>
    typeof entity === 'string' ? `${entity}Model` : `${entity.name}Model`;

export const getRepositoryToken = (entity: ClassType | string): string =>
    typeof entity === 'string' ? `${entity}Repository` : `${entity.name}Repository`;

export const InjectModel = (entity: ClassType) => Inject(getModelToken(entity));
export const InjectRepository = (entity: ClassType) => Inject(getRepositoryToken(entity));

// =========================================================================
// 1. AGRUPACIÓN DE CLASES POR CATEGORÍA
// =========================================================================
const FILTERS = [
    EqOperator, NeOperator, GtOperator, GteOperator, LtOperator, LteOperator,
    InOperator, NinOperator, ExistsOperator, RegexOperator
];

const TRANSFORMS = [
    IfOperator, MultiplyOperator, IncOperator, MinMaxOperator, RoundOperator,
    MathOperator, UpperOperator, TrimOperator, ConcatOperator, DateAddOperator,
    TimeDiffOperator, AggregateOperator
];

const STAGES = [
    MatchStage, SortStage, AddFieldsStage, GroupStage, LimitStage,
    LookupStage, ProjectStage, SkipStage, UnwindStage
];
// =========================================================================
// LISTA DE PROVEEDORES DEL CORE LOGICIAL
// =========================================================================
const CORE_PROVIDERS: Provider[] = [
    GasService,
    // 🟢 EL NUEVO CORAZÓN DE LAS CONSULTAS
    AggregationBuilder,
    PipelineOrchestrator,
    ExpressionEngine,
    TransactionInterceptor,

    // 🟢 2. REGISTRO INDIVIDUAL: NestJS necesita instanciar cada clase individualmente primero
    ...FILTERS,
    ...TRANSFORMS,
    ...STAGES,

    // 🟢 3. FACTORIES (El reemplazo de multi: true):
    // Agrupamos las instancias individuales en un Array bajo sus respectivos tokens
    {
        provide: FILTER_OPERATOR,
        useFactory: (...filters: any[]) => filters,
        inject: FILTERS,
    },
    {
        provide: DATA_TRANSFORM_OPERATOR,
        useFactory: (...transforms: any[]) => transforms,
        inject: TRANSFORMS,
    },
    {
        provide: PIPELINE_STAGE,
        useFactory: (...stages: any[]) => stages,
        inject: STAGES,
    },

    GoogleAutenticarService,
    GoogleHealthService,
    DatabaseConfigService,
    MetadataRegistry,
    NamingStrategy,
    SheetsRepositoryFactory,
    ProjectionService,
    QueryEngine,
    // ExpressionEngine, <-- ⚠️ Nota: Lo tenías duplicado en tu código original, ya está arriba
    InfrastructureProvisioner,
    SheetDataGateway,
    RelationManager,
    DataMapper,
    SheetDocumentHydrator,
    UnitOfWork,
    TransformationEngine,
    ValidationEngine,
    SheetDataTransformer,
    MutationEngine,
    WalManagerService
];

@Global()
@Module({
    imports: [

        HttpModule.register({
            timeout: 5000,
            maxRedirects: 5,
        }),
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
            imports: [

                OutboxModule,
            ],
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
                    useFactory: (factory: SheetsRepositoryFactory) => {
                        // Ahora solo pasamos el Entity (la fábrica resuelve lo demás)
                        return factory.create(Entity);
                    },

                    inject: [SheetsRepositoryFactory],
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