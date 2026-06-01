import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages";
import { CompareEngine } from "@sheetOdm/index";



@Injectable()
export class MatchStage implements IQueryStage {
    constructor(private readonly engine: CompareEngine) { }
    async execute(data: any[], config: any) {
        return data.filter(item => this.engine.applyFilter(item, config));
    }
    validate(config: any): void {
        if (!config || typeof config !== 'object') {
            throw new Error("$MatchStage requiere un objeto de filtrado");
        }
        // ... lógica de validación adicional si la necesitas
    }
}