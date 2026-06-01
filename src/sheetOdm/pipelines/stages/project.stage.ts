import { Injectable } from "@nestjs/common";
import { ROW_INDEX_SYMBOL } from "@sheetOdm/constants/metadata.constants";

import { IQueryStage } from "./IqueryStages";
import { ExpressionEngine } from "@sheetOdm/engines/independientes/expression.engine";

@Injectable()
export class ProjectStage implements IQueryStage {
    constructor(private readonly engine: ExpressionEngine) { }

    async execute(data: any[], config: any): Promise<any[]> {
        return data.map(item => {
            const result: any = {};
            const projectionKeys = Object.keys(config);
            const projected = this.engine.execute(item, config);

            // Aseguramos que projected sea un objeto antes de intentar asignar el símbolo
            if (projected && typeof projected === 'object') {
                if (item && item[ROW_INDEX_SYMBOL] !== undefined) {
                    projected[ROW_INDEX_SYMBOL] = item[ROW_INDEX_SYMBOL];
                }
            }
            projectionKeys.forEach(key => {
                const val = config[key];
                // Si el valor de la proyección es un objeto (ej: { $add: [...] }) 
                // o empieza por $, delegamos al ExpressionEngine
                if (typeof val === 'object' || (typeof val === 'string' && val.startsWith('$'))) {
                    result[key] = this.engine.evaluate(val, item);
                }
            });

            return result;
        });
    }
    validate(config: any): void {
        if (!config || typeof config !== 'object') {
            // CORREGIDO: consistencia en el nombre y mensaje
            throw new Error("$project requiere un objeto de proyección");
        }
    }
}