import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages.js";
import { GroupAccumulator } from "../types.js";
import { ModuleRef } from "@nestjs/core";
import { MetadataRegistry } from "@sheetOdm/services/metadata-registry.service.js";
import { ExpressionEngine } from "../expression.engine.js";


@Injectable()
export class GroupStage implements IQueryStage {
    constructor(private readonly expressionEngine: ExpressionEngine) { }

    validate(config: any): void {
        if (!config || typeof config !== 'object') {
            throw new Error("[$group] Requiere una configuración de objeto válida.");
        }
    }

    execute(data: any[], config: any): any[] {
        const { _id, ...accumulators } = config;
        const groups = new Map<string, any>();

        const AGG_SUM = Symbol('sum');
        const AGG_CNT = Symbol('cnt');

        for (const item of data) {
            // 🟢 Resuelve el ID del grupo usando evaluate (soporta paths anidados nativos)
            const resolvedId = _id !== undefined ? this.expressionEngine.evaluate(_id, item) : null;
            const groupId = resolvedId !== null && resolvedId !== undefined ? String(resolvedId) : 'root';

            if (!groups.has(groupId)) {
                groups.set(groupId, { _id: groupId === 'root' ? null : resolvedId });
            }
            const group = groups.get(groupId);

            for (const [key, accConfig] of Object.entries<any>(accumulators)) {
                if (!accConfig || typeof accConfig !== 'object') continue;

                const [op, fieldPath] = Object.entries(accConfig)[0];
                // 🟢 Evaluamos dinámicamente el valor acumulable
                const value = this.expressionEngine.evaluate(fieldPath, item);

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
                    g[key] = g[key][AGG_SUM] / (g[key][AGG_CNT] || 1);
                }
            }
            return g;
        });
    }



    private applyAccumulator(acc: GroupAccumulator, items: any[]): any {
        const field = Object.keys(acc)[0];
        const targetPath = (acc as any)[field].replace('$', '');
        const getValues = () => items.map(i => Number(i[targetPath]) || 0);

        switch (field) {
            case '$sum': return getValues().reduce((sum, val) => sum + val, 0);
            case '$avg': return getValues().reduce((sum, val) => sum + val, 0) / (items.length || 1);
            case '$min': return items.length ? Math.min(...getValues()) : 0;
            case '$max': return items.length ? Math.max(...getValues()) : 0;
            case '$count': return items.length;
            case '$push': return items.map(i => i[targetPath]);
            default: return null;
        }
    }
}

@Injectable()
export class LookupStage implements IQueryStage {
    private readonly logger = new Logger(LookupStage.name);

    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly metadataRegistry: MetadataRegistry,
        private readonly expressionEngine: ExpressionEngine
    ) { }

    validate(config: any): void {
        if (!config?.from || !config?.localField || !config?.foreignField || !config?.as) {
            throw new BadRequestException("Configuración incompleta para $lookup.");
        }
    }

    async execute(data: any[], config: any): Promise<any[]> {
        this.validate(config);
        const { from, localField, foreignField, as } = config;

        const entityClass = this.metadataRegistry.getEntityBySheetName(from);
        if (!entityClass) {
            this.logger.error(`No se encontró entidad para la hoja: '${from}'`);
            return data;
        }

        const repositoryToken = `${entityClass.name}Repository`;
        let foreignRepository: any;

        try {
            foreignRepository = this.moduleRef.get(repositoryToken, { strict: false });
        } catch {
            this.logger.error(`Repositorio no registrado en el contexto de NestJS: ${repositoryToken}`);
            return data;
        }

        const foreignData = await foreignRepository.findAllRaw?.() ??
            await foreignRepository.find?.({}, { includeInactive: true }) ?? [];

        // 🟢 Index Map O(N+M) - Robusto para buscar campos profundos en la tabla foránea
        const indexMap = foreignData.reduce((map, item) => {
            const rawItem = this.expressionEngine.extractRawData(item);
            const foreignValue = this.expressionEngine.getNestedValue(rawItem, foreignField);

            if (foreignValue !== undefined && foreignValue !== null) {
                const key = String(foreignValue).trim();
                if (!map.has(key)) map.set(key, []);
                map.get(key)!.push(item);
            }
            return map;
        }, new Map<string, any[]>());

        // Mapeo final cruzando colecciones
        return data.map(item => {
            const rawItem = this.expressionEngine.extractRawData(item);
            const localValue = this.expressionEngine.getNestedValue(rawItem, localField);
            const lookupKey = localValue !== undefined && localValue !== null ? String(localValue).trim() : '';

            return {
                ...item,
                [as]: indexMap.get(lookupKey) || []
            };
        });
    }
}

@Injectable()
export class UnwindStage implements IQueryStage {
    async execute(data: any[], config: string | { path: string }) {
        const path = typeof config === 'string' ? config : config.path;
        const field = path.replace('$', '');

        return data.flatMap(item => {
            const arr = item[field];
            if (!Array.isArray(arr) || arr.length === 0) return item;
            return arr.map(subItem => ({ ...item, [field]: subItem }));
        });
    }

    validate(config: any): void {
        if (!config || (typeof config !== 'string' && typeof config !== 'object')) {
            throw new Error("[$unwind] requiere un string o un objeto con la propiedad 'path'.");
        }

        if (typeof config === 'object' && !config.path) {
            throw new Error("[$unwind] El objeto de configuración debe contener la propiedad 'path'.");
        }
    }
}