import { Injectable } from '@nestjs/common';
import { IQueryEngine, QueryOptions } from '@sheetOdm/types/query.types';
import { ExpressionEngine } from '../engines/expression.engine';
import { AggregationEngine } from '../engines/aggregation.engine';
import { ProjectionService } from '../engines/projection.service';
import { LookupStage } from '../engines/query/lookup';
import { MatchStage, SortStage } from '../engines/query/match_sort_pagination';
import { ProjectStage } from '../engines/query/projection';
import { IQueryStage } from '../engines/query/IPipelineStage';

@Injectable()
export class QueryEngine implements IQueryEngine {
    private stageRegistry: Map<string, IQueryStage>;
    constructor(
        private readonly matchStage: MatchStage,
        private readonly projectStage: ProjectStage,
        private readonly sortStage: SortStage,
        private readonly lookupStage: LookupStage,
    ) {
        // Registro centralizado
        this.stageRegistry = new Map([
            ['$match', this.matchStage],
            ['$project', this.projectStage],
            ['$sort', this.sortStage],
            ['$lookup', this.lookupStage],
        ]);
    }

    /**
     * Ejecuta una consulta de filtrado, ordenamiento y paginación sobre una colección en memoria.
     */
    execute<T extends object>(data: T[], filter: any, options?: QueryOptions): any[] {
        let results: any[] = [...data];

        // 1. Filtrar registros usando ExpressionEngine
        if (filter && Object.keys(filter).length > 0) {
            results = results.filter(item => this.expressionEngine.evaluateFilter(item, filter));
        }

        // 2. Ordenamiento
        if (options?.sort) {
            const { field, order } = options.sort;
            results.sort((a: any, b: any) => {
                const valA = a[field];
                const valB = b[field];
                if (valA === valB) return 0;
                if (valA === undefined || valA === null) return 1;
                if (valB === undefined || valB === null) return -1;
                if (order === 'ASC') {
                    return valA < valB ? -1 : 1;
                } else {
                    return valA > valB ? -1 : 1;
                }
            });
        }

        // 3. Paginación: Skip / Offset
        const skip = options?.skip ?? options?.offset ?? 0;
        if (skip > 0) {
            results = results.slice(skip);
        }

        // 4. Paginación: Limit
        if (options?.limit !== undefined && options.limit !== null) {
            results = results.slice(0, options.limit);
        }

        // 5. Proyección
        if (options?.projection) {
            // results = results.map(item => this.projectionService.project(item, options.projection));
        }

        return results;
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
