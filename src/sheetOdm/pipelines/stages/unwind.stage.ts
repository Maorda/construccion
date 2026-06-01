import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages";


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
        if (!config || typeof config !== 'object') {
            throw new Error("$match requiere un objeto de filtrado");
        }
        // ... lógica de validación adicional si la necesitas
    }
}