import { Injectable } from "@nestjs/common";
import { CompareEngine } from "@sheetOdm/index";
import { IQueryStage } from "./IqueryStages";



@Injectable()
export class SortStage implements IQueryStage {
    constructor(private readonly engine: CompareEngine) { }
    async execute(data: any[], config: any) {
        return this.engine.applySort(data, config);
    }
    validate(config: any): void {
        if (!config || typeof config !== 'object') {
            throw new Error("$Sort requiere un objeto de ordenamiento");
        }
        // ... lógica de validación adicional si la necesitas
    }
}