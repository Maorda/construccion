import { Global, Module } from '@nestjs/common';
import { DATA_TRANSFORM_OPERATOR, FILTER_OPERATOR, PIPELINE_STAGE } from './pipeline.constants.js';
import { AggregationBuilder } from './aggregation.builder.js';
import { ExpressionEngine } from './expression.engine.js';
import { EqOperator, NeOperator, GtOperator, GteOperator, LtOperator, LteOperator, InOperator, NinOperator, ExistsOperator, RegexOperator } from './operadores/filter.operators.js';
import { IfOperator, MultiplyOperator, IncOperator, MinMaxOperator, RoundOperator, MathOperator, UpperOperator, TrimOperator, ConcatOperator, DateAddOperator, TimeDiffOperator, AggregateOperator } from './operadores/transform.operators.js';
import { PipelineOrchestrator } from './pipeline.registry.js';
import { GroupStage, LookupStage, UnwindStage } from './stages/Estructura_Compleja.js';
import { MatchStage, AddFieldsStage, ProjectStage } from './stages/filtrado_y_transformacion.js';
import { SortStage, LimitStage, SkipStage } from './stages/orden_y_paginacion.js';
// ... tus importaciones de Stages y Operators

// 1. Agrupamos las clases en arrays constantes
const STAGES = [MatchStage, SortStage, AddFieldsStage, GroupStage, LimitStage, LookupStage, ProjectStage, SkipStage, UnwindStage];
const FILTERS = [EqOperator, NeOperator, GtOperator, GteOperator, LtOperator, LteOperator, InOperator, NinOperator, ExistsOperator, RegexOperator];
const TRANSFORMS = [IfOperator, MultiplyOperator, IncOperator, MinMaxOperator, RoundOperator, MathOperator, UpperOperator, TrimOperator, ConcatOperator, DateAddOperator, TimeDiffOperator, AggregateOperator];

@Module({
    providers: [
        // 2. Registramos todas las clases individualmente para que NestJS pueda instanciarlas
        ...STAGES,
        ...FILTERS,
        ...TRANSFORMS,

        ExpressionEngine,
        PipelineOrchestrator,
        AggregationBuilder,

        // 3. Agrupamos los Stages en un Array bajo el token PIPELINE_STAGE
        {
            provide: PIPELINE_STAGE,
            useFactory: (...stages: any[]) => stages,
            inject: STAGES, // Inyectamos las instancias individuales a la factory
        },

        // 4. Agrupamos los Filtros
        {
            provide: FILTER_OPERATOR,
            useFactory: (...filters: any[]) => filters,
            inject: FILTERS,
        },

        // 5. Agrupamos las Transformaciones
        {
            provide: DATA_TRANSFORM_OPERATOR,
            useFactory: (...transforms: any[]) => transforms,
            inject: TRANSFORMS,
        }
    ],
    exports: [
        AggregationBuilder
    ]
})
export class PipelineModule { }