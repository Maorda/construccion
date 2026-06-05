import { Global, Module, DynamicModule, Provider, Inject, ClassProvider } from '@nestjs/common';
import { PIPELINE_STAGE } from './pipeline.constants';
import { AddFieldsStage, MatchStage, ProjectStage } from './stages/filtrado_y_transformacion';
import { LimitStage, SkipStage, SortStage } from './stages/orden_y_paginacion';
import { PipelineOrchestrator } from './pipeline.registry';
import { GroupStage, LookupStage, UnwindStage } from './stages/Estructura_Compleja';
import { AggregationBuilder } from './aggregation.builder';

@Module({
    providers: [
        // Registro de los stages como Multi-Providers
        { provide: PIPELINE_STAGE, useClass: MatchStage, multi: true } as ClassProvider,
        { provide: PIPELINE_STAGE, useClass: SortStage, multi: true } as ClassProvider,
        { provide: PIPELINE_STAGE, useClass: AddFieldsStage, multi: true } as ClassProvider,
        { provide: PIPELINE_STAGE, useClass: GroupStage, multi: true } as ClassProvider,
        { provide: PIPELINE_STAGE, useClass: LimitStage, multi: true } as ClassProvider,
        { provide: PIPELINE_STAGE, useClass: LookupStage, multi: true } as ClassProvider,
        { provide: PIPELINE_STAGE, useClass: ProjectStage, multi: true } as ClassProvider,
        { provide: PIPELINE_STAGE, useClass: SkipStage, multi: true } as ClassProvider,
        { provide: PIPELINE_STAGE, useClass: UnwindStage, multi: true } as ClassProvider,

        // El orquestador
        PipelineOrchestrator,
        AggregationBuilder
    ],
    exports: [AggregationBuilder]
})
export class PipelineModule { }