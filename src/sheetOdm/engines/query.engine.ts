import { Inject, Injectable } from '@nestjs/common';
import { AggregationPipeline, FilterQuery, IQueryEngine, QueryOptions } from '@sheetOdm/types/query.types.js';
import { IQueryStage } from '@sheetOdm/pipelines/stages/IqueryStages.js';
import { PIPELINE_STAGE } from '@sheetOdm/pipelines/pipeline.constants.js';
import { PipelineOrchestrator } from '@sheetOdm/pipelines/pipeline.registry.js';

@Injectable()
export class QueryEngine implements IQueryEngine {
    private readonly stageRegistry: Map<string, IQueryStage>;

    constructor(
        // Inyectamos el orquestador que ya contiene la lógica de los stages
        private readonly orchestrator: PipelineOrchestrator,
        // Opcionalmente inyectamos la colección si la necesitas para validaciones masivas
        @Inject(PIPELINE_STAGE) private readonly stages: IQueryStage[]
    ) {
        // Mapeo basado en el constructor name de la clase
        this.stageRegistry = new Map<string, IQueryStage>();

        // Creamos un diccionario de mapeo interno
        const operatorMap: Record<string, string> = {
            'MatchStage': '$match',
            'ProjectStage': '$project',
            'LookupStage': '$lookup',
            'SortStage': '$sort',
            'GroupStage': '$group',
            'UnwindStage': '$unwind',
            'AddFieldsStage': '$addFields',
            'LimitStage': '$limit',
            'SkipStage': '$skip'
        };

        this.stages.forEach(stage => {
            const className = stage.constructor.name;
            const operator = operatorMap[className];
            if (operator) {
                this.stageRegistry.set(operator, stage);
            }
        });
    }

    public async execute<T>(data: T[], filter: FilterQuery<T>, options?: QueryOptions): Promise<any[]> {
        const pipeline: any[] = [];

        if (filter && Object.keys(filter).length > 0) pipeline.push({ $match: filter });
        if (options?.sort) pipeline.push({ $sort: { [options.sort.field]: options.sort.order === 'ASC' ? 1 : -1 } });

        const skip = options?.skip ?? options?.offset ?? 0;
        if (skip > 0) pipeline.push({ $skip: skip });
        if (options?.limit !== undefined && options.limit !== null) pipeline.push({ $limit: options.limit });
        if (options?.projection) pipeline.push({ $project: options.projection });

        return await this.aggregate(data, pipeline);
    }

    private validatePipeline(pipeline: any[]): void {
        if (!Array.isArray(pipeline)) {
            throw new Error("[QueryEngine] El pipeline debe ser un array de estadios.");
        }

        for (const stage of pipeline) {
            const operator = Object.keys(stage)[0];
            const config = stage[operator];
            const handler = this.stageRegistry.get(operator);

            if (!handler) {
                throw new Error(`[QueryEngine] Operador no soportado: ${operator}`);
            }

            try {
                handler.validate(config);
            } catch (error: any) {
                throw new Error(`[QueryEngine] Validación fallida en etapa "${operator}": ${error.message}`);
            }
        }
    }

    public async aggregate<T, R = any>(data: T[], pipeline: AggregationPipeline): Promise<R[]> {
        if (!pipeline || pipeline.length === 0) {
            return data as unknown as R[];
        }

        // 🔥 CORRECCIÓN: Validamos el pipeline completo ANTES de empezar a procesar datos
        this.validatePipeline(pipeline);

        let result: any[] = [...data];

        for (let i = 0; i < pipeline.length; i++) {
            const stage = pipeline[i];
            const operator = Object.keys(stage)[0];
            const config = stage[operator];
            const handler = this.stageRegistry.get(operator)!; // Ya validado arriba

            try {
                result = await handler.execute(result, config);
            } catch (error: any) {
                throw new Error(`[QueryEngine] ❌ Error ejecutando etapa "${operator}": ${error.message}`);
            }
        }

        return result as R[];
    }
}