import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages";
import { GroupAccumulator, GroupConfig, LookupConfig } from "../types";
import { StageUtils } from "./StageUtils";
import { RelationEngine } from "@sheetOdm/engines/relationEngine";


@Injectable()
export class GroupStage implements IQueryStage {
    async execute(data: any[], config: GroupConfig): Promise<any[]> {
        const groups = new Map<string, any[]>();

        for (const item of data) {
            const targetField = config._id === null ? 'null' : config._id.replace('$', '');
            const key = String(config._id === null ? 'null' : (item[targetField] ?? 'null'));

            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(item);
        }

        const result: any[] = [];
        for (const [key, items] of groups) {
            const groupResult: any = { _id: key === 'null' ? null : key };

            for (const [fieldName, accumulator] of Object.entries(config)) {
                if (fieldName === '_id') continue;
                groupResult[fieldName] = this.applyAccumulator(accumulator as GroupAccumulator, items);
            }
            result.push(groupResult);
        }
        return result;
    }

    validate(config: any): void {
        StageUtils.validateObject(config, '$group');

        if (!('_id' in config)) {
            throw new Error("[$group] requiere definir un campo '_id'.");
        }

        const validAccumulators = ['$sum', '$avg', '$min', '$max', '$count', '$push'];

        for (const [key, accumulator] of Object.entries(config)) {
            if (key === '_id') continue;

            if (typeof accumulator !== 'object' || accumulator === null) {
                throw new Error(`[$group] El acumulador '${key}' debe ser un objeto.`);
            }

            const operator = Object.keys(accumulator as any)[0];
            if (!validAccumulators.includes(operator)) {
                throw new Error(`[$group] Operador '${operator}' no soportado en el acumulador '${key}'.`);
            }

            const target = (accumulator as any)[operator];
            if (operator !== '$count' && typeof target !== 'string') {
                throw new Error(`[$group] El operador '${operator}' en '${key}' espera un campo string (ej: '$precio').`);
            }
        }
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
    constructor(private readonly engine: RelationEngine) { }

    async execute(data: any[], config: LookupConfig) {
        return await this.engine.applyLookup(data, config as any);
    }

    validate(config: any): void {
        StageUtils.validateObject(config, '$lookup');

        const required = ['from', 'localField', 'foreignField', 'as'];
        for (const field of required) {
            if (!config[field]) {
                throw new Error(`[$lookup] Mal configurado: falta la propiedad obligatoria '${field}'.`);
            }
        }

        if (typeof config.from !== 'string') {
            throw new Error("[$lookup] 'from' debe ser un string (nombre de la colección/hoja).");
        }
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