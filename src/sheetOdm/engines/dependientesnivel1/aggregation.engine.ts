import { Logger } from "@nestjs/common";

import { ModuleRef } from "@nestjs/core";
import { ExpressionEngine } from "./expression.engine";
import { LookupConfig } from "@sheetOdm/pipelines/types";

export class AggregationEngine {
    private readonly logger = new Logger(AggregationEngine.name);
    constructor(
        private expressionEngine: ExpressionEngine,
        protected readonly moduleRef: ModuleRef,
    ) { }


    private applyMatch(item: any, query: Record<string, any>): boolean {
        // Recorremos cada condición del filtro (ej: { estado: 'ACTIVO', sueldo: { $gt: 1500 } })
        return Object.entries(query).every(([key, condition]) => {
            const value = item[key];

            // Si la condición es un objeto (operador como $gt, $in, $ne)
            if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
                const operator = Object.keys(condition)[0];
                const target = condition[operator];

                switch (operator) {
                    case '$gt': return value > target;
                    case '$gte': return value >= target;
                    case '$lt': return value < target;
                    case '$lte': return value <= target;
                    case '$ne': return value !== target;
                    case '$in': return Array.isArray(target) && target.includes(value);
                    case '$nin': return Array.isArray(target) && !target.includes(value);
                    case '$regex': return new RegExp(target, 'i').test(String(value));
                    default: return false;
                }
            }

            // Comparación directa de igualdad
            return value === condition;
        });
    }

    async run(data: any[], pipeline: any[]): Promise<any[]> {
        let result = [...data];

        for (const stage of pipeline) {
            const operator = Object.keys(stage)[0];
            const config = stage[operator];

            switch (operator) {
                case '$match':
                    result = result.filter(item => this.expressionEngine.evaluateFilter(item, config));
                    break;
                case '$lookup':
                    result = await this.executeLookup(result, config);
                    break;
                case '$unwind':
                    result = this.executeUnwind(result, config);
                    break;
                case '$addFields':
                case '$project':
                    result = result.map(item => ({
                        ...item,
                        ...this.expressionEngine.execute(item, config)
                    }));
                    break;
                case '$group':
                    result = this.executeGroup(result, config);
                    break;
                case '$sort':
                    result = this.executeSort(result, config);
                    break;
                default:
                    this.logger.warn(`[AggregationEngine] Operador de pipeline no soportado: ${operator}`);
            }
        }
        return result;
    }

    private async executeLookup(currentData: any[], config: LookupConfig): Promise<any[]> {
        const { from, localField, foreignField, as } = config;

        // Resolución dinámica del token del repositorio basado en el nombre de la pestaña
        const camelCase = from.toLowerCase().replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        const pascalCase = camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
        const repositoryToken = `${pascalCase}Repository`;

        let foreignData: any[] = [];
        try {
            const foreignRepository = this.moduleRef.get(repositoryToken, { strict: false });

            if (foreignRepository && typeof foreignRepository.findAllRaw === 'function') {
                foreignData = await foreignRepository.findAllRaw();
            } else if (foreignRepository && typeof foreignRepository.find === 'function') {
                foreignData = await foreignRepository.find({}, { includeInactive: true });
            } else {
                throw new Error(`El repositorio no posee métodos válidos de extracción de datos.`);
            }
        } catch (error: any) {
            this.logger.error(`[Lookup Error] Fallo al cruzar pestaña '${from}': ${error.message}`);
            foreignData = [];
        }

        // Construcción del índice mapeado en memoria O(1)
        const indexMap = this.createIndexMap(foreignData, foreignField);

        // Cruce secuencial sobre el hilo de datos actual
        return currentData.map(item => {
            const localVal = String(item[localField] ?? '');
            return {
                ...item,
                [as]: indexMap.get(localVal) || []
            };
        });
    }

    private createIndexMap(data: any[], key: string): Map<string, any[]> {
        const index = new Map<string, any[]>();
        for (const item of data) {
            const val = String(item[key] ?? '');
            if (!index.has(val)) index.set(val, []);
            index.get(val)!.push(item);
        }
        return index;
    }

    private executeUnwind(data: any[], path: string): any[] {
        const field = path.startsWith('$') ? path.substring(1) : path;
        const result: any[] = [];

        for (const item of data) {
            const arrayToUnwind = item[field];

            if (Array.isArray(arrayToUnwind) && arrayToUnwind.length > 0) {
                for (const subItem of arrayToUnwind) {
                    result.push({ ...item, [field]: subItem });
                }
            } else {
                result.push({ ...item, [field]: null });
            }
        }
        return result;
    }

    private executeGroup(data: any[], config: any): any[] {
        const { _id, ...accumulators } = config;
        const groups = new Map<string, any>();

        for (const item of data) {
            const groupId = _id && typeof _id === 'string' && _id.startsWith('$')
                ? item[_id.substring(1)]
                : 'root';

            if (!groups.has(groupId)) {
                groups.set(groupId, { _id: groupId });
            }

            const group = groups.get(groupId);

            for (const [key, accConfig] of Object.entries<any>(accumulators)) {
                const operator = Object.keys(accConfig)[0];
                const fieldPath = accConfig[operator];
                const value = typeof fieldPath === 'string' && fieldPath.startsWith('$')
                    ? item[fieldPath.substring(1)]
                    : null;

                switch (operator) {
                    case '$sum':
                        group[key] = (group[key] || 0) + (Number(value) || 0);
                        break;
                    case '$count':
                        group[key] = (group[key] || 0) + 1;
                        break;
                    case '$avg':
                        group[`${key}_sum`] = (group[`${key}_sum`] || 0) + (Number(value) || 0);
                        group[`${key}_cnt`] = (group[`${key}_cnt`] || 0) + 1;
                        group[key] = group[`${key}_sum`] / group[`${key}_cnt`];
                        break;
                    case '$push':
                        if (!group[key]) group[key] = [];
                        group[key].push(item);
                        break;
                }
            }
        }

        return Array.from(groups.values()).map(g => {
            Object.keys(g).forEach(k => {
                if (k.includes('_sum') || k.includes('_cnt')) delete g[k];
            });
            return g;
        });
    }

    private executeSort(data: any[], sortConfig: Record<string, 1 | -1>): any[] {
        return [...data].sort((a, b) => {
            for (const key in sortConfig) {
                const dir = sortConfig[key];
                if (a[key] > b[key]) return dir;
                if (a[key] < b[key]) return -dir;
            }
            return 0;
        });
    }




}