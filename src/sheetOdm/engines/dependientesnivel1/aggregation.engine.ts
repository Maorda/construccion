import { Logger, Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { LookupConfig } from "@sheetOdm/pipelines/types";
import { ExpressionEngine } from "../independientes/expression.engine";
import { MetadataRegistry } from "@sheetOdm/services/metadata-registry.service";

@Injectable()
export class AggregationEngine {
    private readonly logger = new Logger(AggregationEngine.name);

    // Mapa de manejadores para evitar el switch gigante
    private readonly pipelineHandlers: Record<string, (data: any[], config: any) => Promise<any[]> | any[]> = {
        '$match': (data, config) => data.filter(item => this.expressionEngine.evaluateFilter(item, config)),
        '$lookup': (data, config) => this.executeLookup(data, config),
        '$unwind': (data, config) => this.executeUnwind(data, config),
        '$addFields': (data, config) => this.applyTransform(data, config, true),
        '$project': (data, config) => this.applyTransform(data, config, false),
        '$group': (data, config) => this.executeGroup(data, config),
        '$sort': (data, config) => this.executeSort(data, config),
    };

    constructor(
        private readonly expressionEngine: ExpressionEngine,
        private readonly moduleRef: ModuleRef,
        private readonly metadataRegistry: MetadataRegistry
    ) { }

    async run(data: any[], pipeline: any[]): Promise<any[]> {
        let result = [...data];

        for (const stage of pipeline) {
            const operator = Object.keys(stage)[0];
            const config = stage[operator];
            const handler = this.pipelineHandlers[operator];

            if (!handler) {
                this.logger.warn(`[AggregationEngine] Operador no soportado: ${operator}`);
                continue;
            }

            result = await Promise.resolve(handler(result, config));
        }
        return result;
    }

    // --- MANEJADORES PRIVADOS ---

    private async executeLookup(currentData: any[], config: LookupConfig): Promise<any[]> {
        const { from, localField, foreignField, as } = config;

        // 1. Resolvemos la clase real usando nuestro Registro de Metadatos
        const entityClass = this.metadataRegistry.getEntityBySheetName(from);

        if (!entityClass) {
            this.logger.error(`[Lookup] No se encontró entidad registrada para la hoja: '${from}'`);
            return currentData;
        }

        // 2. Construimos el token oficial que usa OdmSheetModule
        const repositoryToken = `${entityClass.name}Repository`;
        const foreignRepository = this.moduleRef.get(repositoryToken, { strict: false });

        if (!foreignRepository) {
            this.logger.error(`[Lookup] Repositorio no encontrado: ${repositoryToken}`);
            return currentData;
        }

        // ... (el resto del código de búsqueda es igual)
        const foreignData = await foreignRepository.findAllRaw?.() ?? await foreignRepository.find?.({}, { includeInactive: true }) ?? [];
        const indexMap = this.createIndexMap(foreignData, foreignField);

        return currentData.map(item => ({
            ...item,
            [as]: indexMap.get(String(item[localField] ?? '')) || []
        }));
    }

    private executeGroup(data: any[], config: any): any[] {
        const { _id, ...accumulators } = config;
        const groups = new Map<string, any>();

        // Símbolos para evitar colisiones con datos del usuario
        const AGG_SUM = Symbol('sum');
        const AGG_CNT = Symbol('cnt');

        for (const item of data) {
            const groupId = (_id && typeof _id === 'string' && _id.startsWith('$'))
                ? item[_id.substring(1)] : 'root';

            if (!groups.has(groupId)) groups.set(groupId, { _id: groupId });
            const group = groups.get(groupId);

            for (const [key, accConfig] of Object.entries<any>(accumulators)) {
                const [op, fieldPath] = Object.entries(accConfig)[0];
                const value = (typeof fieldPath === 'string' && fieldPath.startsWith('$'))
                    ? item[fieldPath.substring(1)] : null;

                switch (op) {
                    case '$sum':
                        group[key] = (group[key] || 0) + (Number(value) || 0);
                        break;
                    case '$count':
                        group[key] = (group[key] || 0) + 1;
                        break;
                    case '$avg':
                        group[key] = group[key] || { [AGG_SUM]: 0, [AGG_CNT]: 0 };
                        group[key][AGG_SUM] += (Number(value) || 0);
                        group[key][AGG_CNT] += 1;
                        break;
                }
            }
        }

        return Array.from(groups.values()).map(g => {
            for (const key in g) {
                if (g[key] && typeof g[key] === 'object' && AGG_SUM in g[key]) {
                    g[key] = g[key][AGG_SUM] / g[key][AGG_CNT];
                }
            }
            return g;
        });
    }

    private applyTransform(data: any[], config: any, keepExisting: boolean): any[] {
        return data.map(item => ({
            ...(keepExisting ? item : {}),
            ...this.expressionEngine.execute(item, config)
        }));
    }

    private createIndexMap(data: any[], key: string): Map<string, any[]> {
        return data.reduce((map, item) => {
            const val = String(item[key] ?? '');
            if (!map.has(val)) map.set(val, []);
            map.get(val)!.push(item);
            return map;
        }, new Map<string, any[]>());
    }

    private executeUnwind(data: any[], config: any): any[] {
        const path = typeof config === 'string' ? config : config.path;
        const preserveNull = typeof config === 'object' && config.preserveNullAndEmptyArrays === true;

        const field = path.startsWith('$') ? path.substring(1) : path;
        const result: any[] = [];

        for (const item of data) {
            const arrayToUnwind = item[field];

            if (Array.isArray(arrayToUnwind) && arrayToUnwind.length > 0) {
                for (const subItem of arrayToUnwind) {
                    result.push({ ...item, [field]: subItem });
                }
            } else if (preserveNull) {
                result.push({ ...item, [field]: null });
            }
        }
        return result;
    }

    // 4. Implementación optimizada de Sort
    private executeSort(data: any[], sortConfig: Record<string, 1 | -1>): any[] {
        return [...data].sort((a, b) => {
            for (const [key, dir] of Object.entries(sortConfig)) {
                if (a[key] === b[key]) continue;
                // dir es 1 o -1, lo que permite invertir la comparación dinámicamente
                return a[key] > b[key] ? dir : -dir;
            }
            return 0;
        });
    }
}