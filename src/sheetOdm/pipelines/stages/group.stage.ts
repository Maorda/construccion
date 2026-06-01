import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages";
import { GroupAccumulator, GroupConfig } from "../types";


@Injectable()
export class GroupStage implements IQueryStage {
    async execute(data: any[], config: GroupConfig): Promise<any[]> {
        const groups = new Map<string, any[]>();

        for (const item of data) {
            // Robustez: Soporte para campos simples limpiando el operador $
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
        // 1. Verificación básica de objeto
        if (!config || typeof config !== 'object') {
            throw new Error("$group requiere un objeto de configuración");
        }

        // 2. _id es obligatorio
        if (!('_id' in config)) {
            throw new Error("$group requiere definir un campo '_id'");
        }

        // 3. Definimos los operadores permitidos
        const validAccumulators = ['$sum', '$avg', '$min', '$max', '$count', '$push'];

        // 4. Validar acumuladores
        for (const [key, accumulator] of Object.entries(config)) {
            if (key === '_id') continue;

            // Cada acumulador debe ser un objeto: { $sum: "$campo" }
            if (typeof accumulator !== 'object' || accumulator === null) {
                throw new Error(`$group: el acumulador '${key}' debe ser un objeto.`);
            }

            const operator = Object.keys(accumulator as any)[0];

            if (!validAccumulators.includes(operator)) {
                throw new Error(`$group: operador '${operator}' no soportado en el acumulador '${key}'.`);
            }

            // Opcional: Validar que el valor sea un string (el campo a procesar)
            // excepto para $count que a veces se usa diferente
            const target = (accumulator as any)[operator];
            if (operator !== '$count' && typeof target !== 'string') {
                throw new Error(`$group: el operador '${operator}' en '${key}' espera un campo string (ej: '$precio').`);
            }
        }
    }
    private applyAccumulator(acc: GroupAccumulator, items: any[]): any {
        const field = Object.keys(acc)[0];
        const targetPath = (acc as any)[field].replace('$', '');

        // Helper seguro para resolver valores numéricos intermedios
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