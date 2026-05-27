import { Injectable } from '@nestjs/common';
import { ExpressionEngine } from './expression.engine';
import { ProjectionService } from './projection.service';

@Injectable()
export class AggregationEngine {
    constructor(
        private readonly expressionEngine: ExpressionEngine,
        private readonly projectionService: ProjectionService,
    ) {}

    /**
     * Ejecuta un pipeline de agregación secuencial sobre un conjunto de datos en memoria.
     */
    async aggregate<T extends object>(data: T[], pipeline: any[]): Promise<any[]> {
        let currentResults: any[] = [...data];

        for (const stage of pipeline) {
            const keys = Object.keys(stage);
            if (keys.length === 0) continue;

            const operator = keys[0];
            const config = stage[operator];

            switch (operator) {
                case '$match':
                    currentResults = currentResults.filter(item =>
                        this.expressionEngine.evaluateFilter(item, config)
                    );
                    break;

                case '$project':
                    currentResults = currentResults.map(item =>
                        this.projectionService.project(item, config)
                    );
                    break;

                case '$sort':
                    currentResults = this.sort(currentResults, config);
                    break;

                case '$skip':
                    const skipCount = Number(config);
                    currentResults = currentResults.slice(skipCount);
                    break;

                case '$limit':
                    const limitCount = Number(config);
                    currentResults = currentResults.slice(0, limitCount);
                    break;

                case '$group':
                    currentResults = this.group(currentResults, config);
                    break;

                default:
                    // Si hay un operador no soportado, lo ignoramos de forma segura
                    break;
            }
        }

        return currentResults;
    }

    private sort(data: any[], config: Record<string, number>): any[] {
        const sorted = [...data];
        const fields = Object.keys(config);
        if (fields.length === 0) return sorted;

        sorted.sort((a, b) => {
            for (const field of fields) {
                const order = config[field]; // 1 para ASC, -1 para DESC
                const valA = a[field];
                const valB = b[field];

                if (valA === valB) continue;
                if (valA === undefined || valA === null) return 1;
                if (valB === undefined || valB === null) return -1;

                if (valA < valB) return order === 1 ? -1 : 1;
                if (valA > valB) return order === 1 ? 1 : -1;
            }
            return 0;
        });

        return sorted;
    }

    private group(data: any[], config: any): any[] {
        const idField = config._id; // Puede ser un path a campo '$edad' o null/constante
        const accumulatorKeys = Object.keys(config).filter(key => key !== '_id');

        const groups = new Map<any, any[]>();

        // 1. Agrupar los datos por la clave identificada
        for (const item of data) {
            let keyVal: any;

            if (idField === null || idField === undefined) {
                keyVal = null;
            } else if (typeof idField === 'string' && idField.startsWith('$')) {
                const realField = idField.substring(1);
                keyVal = item[realField];
            } else {
                keyVal = idField;
            }

            if (!groups.has(keyVal)) {
                groups.set(keyVal, []);
            }
            groups.get(keyVal)!.push(item);
        }

        const results: any[] = [];

        // 2. Procesar los acumuladores para cada grupo
        groups.forEach((groupItems, groupKey) => {
            const groupResult: any = { _id: groupKey };

            for (const accKey of accumulatorKeys) {
                const accConfig = config[accKey];
                const accOp = Object.keys(accConfig)[0];
                const expr = accConfig[accOp];

                let fieldName = '';
                if (typeof expr === 'string' && expr.startsWith('$')) {
                    fieldName = expr.substring(1);
                }

                const values = groupItems
                    .map(item => (fieldName ? Number(item[fieldName]) : 1))
                    .filter(val => !isNaN(val));

                switch (accOp) {
                    case '$sum':
                        groupResult[accKey] = values.reduce((sum, val) => sum + val, 0);
                        break;
                    case '$avg':
                        groupResult[accKey] = values.length > 0 
                            ? values.reduce((sum, val) => sum + val, 0) / values.length 
                            : 0;
                        break;
                    case '$min':
                        groupResult[accKey] = values.length > 0 ? Math.min(...values) : null;
                        break;
                    case '$max':
                        groupResult[accKey] = values.length > 0 ? Math.max(...values) : null;
                        break;
                    case '$push':
                        groupResult[accKey] = groupItems.map(item => fieldName ? item[fieldName] : item);
                        break;
                    default:
                        groupResult[accKey] = null;
                }
            }

            results.push(groupResult);
        });

        return results;
    }
}
