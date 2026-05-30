import { Injectable } from '@nestjs/common';
import { FilterQuery, IQueryEngine, QueryOptions } from '@sheetOdm/types/query.types';
import { MatchStage, SortStage } from '../engines/query/match_sort_pagination';
import { ProjectStage } from '../engines/query/projection';
import { IQueryStage } from '../engines/query/IPipelineStage';
import { AddFieldsStage } from './stages/add-fields.stage';
import { GroupStage } from './stages/group.stage';
import { LimitStage } from './stages/limit.stage';
import { LookupStage } from './stages/lookup.stage';
import { SkipStage } from './stages/skip.stage';
import { UnwindStage } from './stages/unwind.stage';
import { ExpressionEngine } from '@sheetOdm/engines/expression.engine';
import { ProjectionService } from '@sheetOdm/engines/projection.service';

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

        // Agrega estos dos
        private readonly expressionEngine: ExpressionEngine,
        private readonly projectionService: ProjectionService,
    ) {
        // Registro centralizado
        this.stageRegistry = new Map<string, IQueryStage>([
            ['$match', this.match],
            ['$project', this.project],
            ['$lookup', this.lookup],
            ['$sort', this.sort],
            ['$group', this.group],
            ['$unwind', this.unwind],
            ['$addFields', this.addFields],
            ['$limit', this.limit],
            ['$skip', this.skip]
        ]);
    }

    /**
     * Ejecuta una consulta de filtrado, ordenamiento y paginación sobre una colección en memoria.
     */
    public async execute<T extends object>(
        data: T[],
        filter: FilterQuery<T>,
        options?: QueryOptions
    ): Promise<any[]> {

        const pipeline: any[] = [];

        // 1. Convertir 'filter' a $match
        if (filter && Object.keys(filter).length > 0) {
            pipeline.push({ $match: filter });
        }

        // 2. Convertir 'sort' a $sort
        if (options?.sort) {
            // Asumiendo que tu SortStage acepta { field, order } o el formato de MongoDB
            pipeline.push({ $sort: { [options.sort.field]: options.sort.order === 'ASC' ? 1 : -1 } });
        }

        // 3. Paginación: Skip
        const skip = options?.skip ?? options?.offset ?? 0;
        if (skip > 0) {
            pipeline.push({ $skip: skip });
        }

        // 4. Paginación: Limit
        if (options?.limit !== undefined && options.limit !== null) {
            pipeline.push({ $limit: options.limit });
        }

        // 5. Proyección
        if (options?.projection) {
            pipeline.push({ $project: options.projection });
        }

        // ¡La magia! Reutilizamos toda la lógica ya probada en aggregate
        return await this.aggregate(data, pipeline);
    }

    /**
     * Ejecuta un pipeline de agregación.
     */
    public async aggregate(data: any[], pipeline: any[]): Promise<any[]> {
        let result = [...data];

        for (const stage of pipeline) {
            const operator = Object.keys(stage)[0];
            const config = stage[operator];
            const handler = this.stageRegistry.get(operator);

            if (!handler) {
                throw new Error(`Operador no soportado en el pipeline: ${operator}`);
            }

            // Ejecución polimórfica (soporta sync y async)
            result = await handler.execute(result, config);
        }

        return result;
    }
}
