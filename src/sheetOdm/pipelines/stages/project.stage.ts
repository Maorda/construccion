import { Injectable } from "@nestjs/common";
import { ROW_INDEX_SYMBOL } from "@sheetOdm/constants/metadata.constants";
import { ExpressionEngine } from "@sheetOdm/engines/expression.engine";
import { IQueryStage } from "@sheetOdm/engines/query/IPipelineStage";

@Injectable()
export class ProjectStage implements IQueryStage {
    constructor(private readonly engine: ExpressionEngine) { }

    async execute(data: any[], config: any): Promise<any[]> {
        return data.map(item => {
            // El motor limpia y proyecta las propiedades deseadas
            const projected = this.engine.execute(item, config);

            // 🔥 SOLUCIÓN CRÍTICA: Traspasar el símbolo operacional de fila al nuevo objeto estructurado
            if (item && item[ROW_INDEX_SYMBOL] !== undefined) {
                projected[ROW_INDEX_SYMBOL] = item[ROW_INDEX_SYMBOL];
            }

            return projected;
        });
    }
}