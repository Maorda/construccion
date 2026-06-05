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

import { RelationManager } from '@sheetOdm/services/relation-manager.service';
import { DataMapper } from '@sheetOdm/services/data-mapper.service';
import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator';

import { TransformationEngine } from '@sheetOdm/engines/TransformationEngine';
import { ValidationEngine } from '@sheetOdm/engines/ValidationEngine';

import { QueryEngine } from '@sheetOdm/engines/query.engine';
import { ExpressionEngine } from '@sheetOdm/pipelines/expression.engine';

// Pipeline Stages (Agregaciones)
import { PipelineOrchestrator } from '@sheetOdm/pipelines/pipeline.registry';
import { AddFieldsStage, MatchStage, ProjectStage } from '@sheetOdm/pipelines/stages/filtrado_y_transformacion';
import { GroupStage, LookupStage, UnwindStage } from '@sheetOdm/pipelines/stages/Estructura_Compleja';
import { LimitStage, SkipStage, SortStage } from '@sheetOdm/pipelines/stages/orden_y_paginacion';

// Tipos e Interfaces
import { ClassType } from '@sheetOdm/types/query.types';
import { DatabaseModuleOptions, DatabaseModuleAsyncOptions, GoogleDriveConfig } from '@sheetOdm/interfaces/database.options.interface';
import { createModel } from '@sheetOdm/repository/create-model';
import { AggregationBuilder } from './pipelines/aggregation.builder';
import { DATA_TRANSFORM_OPERATOR, FILTER_OPERATOR, PIPELINE_STAGE } from './pipelines/pipeline.constants';
import { EqOperator, NeOperator, GtOperator, GteOperator, LtOperator, LteOperator, InOperator, NinOperator, ExistsOperator, RegexOperator } from './pipelines/operadores/filter.operators';
import { IfOperator, MultiplyOperator, IncOperator, MinMaxOperator, RoundOperator, MathOperator, UpperOperator, TrimOperator, ConcatOperator, DateAddOperator, TimeDiffOperator, AggregateOperator } from './pipelines/operadores/transform.operators';

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
// LISTA DE PROVEEDORES DEL CORE LOGICIAL
// =========================================================================
const CORE_PROVIDERS: Provider[] = [
    // 🟢 EL NUEVO CORAZÓN DE LAS CONSULTAS
    AggregationBuilder,
    PipelineOrchestrator,
    ExpressionEngine,

    // 🟢 REFACTORIZACIÓN MULTI-PROVIDER STAGES:
    // Conectamos cada clase al token PIPELINE_STAGE que el orquestador exige vía @Inject
    // 2. Operadores de Filtro (Multi-Provider)
    { provide: FILTER_OPERATOR, useClass: EqOperator },
    { provide: FILTER_OPERATOR, useClass: NeOperator },
    { provide: FILTER_OPERATOR, useClass: GtOperator },
    { provide: FILTER_OPERATOR, useClass: GteOperator },
    { provide: FILTER_OPERATOR, useClass: LtOperator },
    { provide: FILTER_OPERATOR, useClass: LteOperator },
    { provide: FILTER_OPERATOR, useClass: InOperator },
    { provide: FILTER_OPERATOR, useClass: NinOperator },
    { provide: FILTER_OPERATOR, useClass: ExistsOperator },
    { provide: FILTER_OPERATOR, useClass: RegexOperator },

    // 3. Operadores de Transformación (Multi-Provider)
    { provide: DATA_TRANSFORM_OPERATOR, useClass: IfOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: MultiplyOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: IncOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: MinMaxOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: RoundOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: MathOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: UpperOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: TrimOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: ConcatOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: DateAddOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: TimeDiffOperator },
    { provide: DATA_TRANSFORM_OPERATOR, useClass: AggregateOperator },

    // 4. Pipeline Stages (Multi-Provider)
    { provide: PIPELINE_STAGE, useClass: MatchStage },
    { provide: PIPELINE_STAGE, useClass: SortStage },
    { provide: PIPELINE_STAGE, useClass: AddFieldsStage },
    { provide: PIPELINE_STAGE, useClass: GroupStage },
    { provide: PIPELINE_STAGE, useClass: LimitStage },
    { provide: PIPELINE_STAGE, useClass: LookupStage },
    { provide: PIPELINE_STAGE, useClass: ProjectStage },
    { provide: PIPELINE_STAGE, useClass: SkipStage },
    { provide: PIPELINE_STAGE, useClass: UnwindStage },

    GoogleAutenticarService,
    GoogleHealthService,
    DatabaseConfigService,
    MetadataRegistry,
    NamingStrategy,
    SheetsRepositoryFactory,
    ProjectionService,
    QueryEngine,
    ExpressionEngine,
    InfrastructureProvisioner,
    SheetDataGateway,
    RelationManager,
    DataMapper,
    SheetDocumentHydrator,
    UnitOfWork,
    TransformationEngine,
    ValidationEngine,
    //HydrationEngine,
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