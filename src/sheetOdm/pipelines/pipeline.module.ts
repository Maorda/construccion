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

        // 5. Orquestador e Interfaz Pública (Fachada)
        PipelineOrchestrator,
        AggregationBuilder
    ],
    exports: [
        AggregationBuilder // Único punto de interacción expuesto hacia el exterior
    ]
})
export class PipelineModule { }