import { Injectable } from "@nestjs/common";
import { IQueryStage } from "@sheetOdm/engines/query/IPipelineStage";
import { GroupAccumulator, GroupConfig } from "../types";


@Injectable()
export class GroupStage implements IQueryStage {
    async execute(data: any[], config: GroupConfig): Promise<any[]> {
        // 1. Agrupar por la clave definida en _id
        const groups = new Map<string, any[]>();

        for (const item of data) {
            // Evaluamos la clave de grupo (soporta literales o acceso a propiedad)
            const key = String(config._id === null ? 'null' : item[config._id.replace('$', '')]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(item);
        }

        // 2. Procesar acumuladores
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

    private applyAccumulator(acc: GroupAccumulator, items: any[]): any {
        const field = Object.keys(acc)[0]; // ej: $sum, $avg
        const targetPath = (acc as any)[field].replace('$', '');

        switch (field) {
            case '$sum': return items.reduce((sum, item) => sum + (Number(item[targetPath]) || 0), 0);
            case '$avg': return items.reduce((sum, item) => sum + (Number(item[targetPath]) || 0), 0) / items.length;
            case '$min': return Math.min(...items.map(i => i[targetPath]));
            case '$max': return Math.max(...items.map(i => i[targetPath]));
            case '$count': return items.length;
            case '$push': return items.map(i => i[targetPath]);
            default: return null;
        }
    }
}