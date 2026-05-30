import { Injectable } from "@nestjs/common";
import { IQueryStage } from "@sheetOdm/engines/query/IPipelineStage";
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