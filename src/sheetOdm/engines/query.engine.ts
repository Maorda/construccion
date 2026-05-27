import { Injectable } from '@nestjs/common';
import { IQueryEngine, QueryOptions } from '@sheetOdm/types/query.types';
import { ExpressionEngine } from './expression.engine';
import { AggregationEngine } from './aggregation.engine';
import { ProjectionService } from './projection.service';

@Injectable()
export class QueryEngine implements IQueryEngine {
    constructor(
        private readonly expressionEngine: ExpressionEngine,
        private readonly aggregationEngine: AggregationEngine,
        private readonly projectionService: ProjectionService,
    ) {}

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
            results = results.map(item => this.projectionService.project(item, options.projection));
        }

        return results;
    }

    /**
     * Ejecuta un pipeline de agregación.
     */
    async aggregate<T extends object>(data: T[], pipeline: any[]): Promise<any[]> {
        return this.aggregationEngine.aggregate(data, pipeline);
    }
}
