import { Injectable } from '@nestjs/common';
import { AggregationPipeline, FilterQuery, IQueryEngine, QueryOptions } from '@sheetOdm/types/query.types';
import { IQueryStage } from '@sheetOdm/pipelines/stages/IqueryStages';
import { LookupStage, GroupStage, UnwindStage } from '@sheetOdm/pipelines/stages/Estructura_Compleja';
import { MatchStage, ProjectStage, AddFieldsStage } from '@sheetOdm/pipelines/stages/filtrado_y_transformacion';
import { SortStage, LimitStage, SkipStage } from '@sheetOdm/pipelines/stages/orden_y_paginacion';


@Injectable()
export class QueryEngine implements IQueryEngine {
    private stageRegistry: Map<string, IQueryStage>;

    constructor(
        private readonly match: MatchStage,
        private readonly project: ProjectStage,
        private readonly lookup: LookupStage,
        private readonly sort: SortStage,
        private readonly group: GroupStage,
        private readonly unwind: UnwindStage,
        private readonly addFields: AddFieldsStage,
        private readonly limit: LimitStage,
        private readonly skip: SkipStage,
    ) {
        // La clave aquí es decirle a TS que el array contiene pares de [string, IQueryStage]
        const stages: [string, IQueryStage][] = [
            ['$match', this.match],
            ['$project', this.project],
            ['$lookup', this.lookup],
            ['$sort', this.sort],
            ['$group', this.group],
            ['$unwind', this.unwind],
            ['$addFields', this.addFields],
            ['$limit', this.limit],
            ['$skip', this.skip]




        ];

        this.stageRegistry = new Map<string, IQueryStage>(stages);
    }

    /**
     * Ejecuta una consulta de filtrado, ordenamiento y paginación sobre una colección en memoria.
     */
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

            // Llamamos al nuevo método de validación
            try {
                handler.validate(config);
            } catch (error: any) {
                throw new Error(`[QueryEngine] Validación fallida en etapa "${operator}": ${error.message}`);
            }
        }
    }

    public async aggregate<T, R = any>(
        data: T[],
        pipeline: AggregationPipeline
    ): Promise<R[]> {
        // Validación de pipeline vacío
        if (!pipeline || pipeline.length === 0) {
            return data as unknown as R[];
        }

        let result: any[] = [...data];

        // Ejecución secuencial (los pipelines de agregación son bloqueantes por orden)
        for (let i = 0; i < pipeline.length; i++) {
            const stage = pipeline[i];
            const operator = Object.keys(stage)[0];
            const config = stage[operator];

            const handler = this.stageRegistry.get(operator);

            if (!handler) {
                throw new Error(`[QueryEngine] ❌ Operador "${operator}" no registrado en el engine.`);
            }

            try {
                // Ejecutamos la etapa
                result = await handler.execute(result, config);

                // Logging opcional para depuración (muy útil en producción)
                // this.logger.debug(`Etapa ${i + 1}: ${operator} completada. Registros actuales: ${result.length}`);
            } catch (error: any) {
                throw new Error(`[QueryEngine] ❌ Error en la etapa "${operator}" (índice ${i}): ${error.message}`);
            }
        }

        return result as R[];
    }


}
