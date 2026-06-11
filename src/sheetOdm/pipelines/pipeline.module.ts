import { Global, Module, DynamicModule, Provider, Inject, ClassProvider } from '@nestjs/common';
import { DATA_TRANSFORM_OPERATOR, FILTER_OPERATOR, PIPELINE_STAGE } from './pipeline.constants';
import { AddFieldsStage, MatchStage, ProjectStage } from './stages/filtrado_y_transformacion';
import { LimitStage, SkipStage, SortStage } from './stages/orden_y_paginacion';
import { PipelineOrchestrator } from './pipeline.registry';
import { GroupStage, LookupStage, UnwindStage } from './stages/Estructura_Compleja';
import { AggregationBuilder } from './aggregation.builder';
import { ExpressionEngine } from './expression.engine';
import { EqOperator, NeOperator, GtOperator, GteOperator, LtOperator, LteOperator, InOperator, NinOperator, ExistsOperator, RegexOperator } from './operadores/filter.operators';
import { IfOperator, MultiplyOperator, IncOperator, MinMaxOperator, RoundOperator, MathOperator, UpperOperator, TrimOperator, ConcatOperator, DateAddOperator, TimeDiffOperator, AggregateOperator } from './operadores/transform.operators';

@Module({
    providers: [
        // 1. Registro del Motor Central de Expresiones
        ExpressionEngine,

        // 2. Operadores de Filtro (Multi-Provider)
        { provide: FILTER_OPERATOR, useClass: EqOperator, multi: true } as any,
        { provide: FILTER_OPERATOR, useClass: NeOperator, multi: true } as any,
        { provide: FILTER_OPERATOR, useClass: GtOperator, multi: true } as any,
        { provide: FILTER_OPERATOR, useClass: GteOperator, multi: true } as any,
        { provide: FILTER_OPERATOR, useClass: LtOperator, multi: true } as any,
        { provide: FILTER_OPERATOR, useClass: LteOperator, multi: true } as any,
        { provide: FILTER_OPERATOR, useClass: InOperator, multi: true } as any,
        { provide: FILTER_OPERATOR, useClass: NinOperator, multi: true } as any,
        { provide: FILTER_OPERATOR, useClass: ExistsOperator, multi: true } as any,
        { provide: FILTER_OPERATOR, useClass: RegexOperator, multi: true } as any,

        // 3. Operadores de Transformación (Multi-Provider)
        { provide: DATA_TRANSFORM_OPERATOR, useClass: IfOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: MultiplyOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: IncOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: MinMaxOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: RoundOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: MathOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: UpperOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: TrimOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: ConcatOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: DateAddOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: TimeDiffOperator, multi: true } as any,
        { provide: DATA_TRANSFORM_OPERATOR, useClass: AggregateOperator, multi: true } as any,

        // 4. Pipeline Stages (Multi-Provider)
        { provide: PIPELINE_STAGE, useClass: MatchStage, multi: true } as any,
        { provide: PIPELINE_STAGE, useClass: SortStage, multi: true } as any,
        { provide: PIPELINE_STAGE, useClass: AddFieldsStage, multi: true } as any,
        { provide: PIPELINE_STAGE, useClass: GroupStage, multi: true } as any,
        { provide: PIPELINE_STAGE, useClass: LimitStage, multi: true } as any,
        { provide: PIPELINE_STAGE, useClass: LookupStage, multi: true } as any,
        { provide: PIPELINE_STAGE, useClass: ProjectStage, multi: true } as any,
        { provide: PIPELINE_STAGE, useClass: SkipStage, multi: true } as any,
        { provide: PIPELINE_STAGE, useClass: UnwindStage, multi: true } as any,

        // 5. Orquestador e Interfaz Pública (Fachada)
        PipelineOrchestrator,
        AggregationBuilder
    ],
    exports: [
        AggregationBuilder // Único punto de interacción expuesto hacia el exterior
    ]
})
export class PipelineModule { }