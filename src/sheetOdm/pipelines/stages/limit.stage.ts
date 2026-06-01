import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages";

@Injectable()
export class LimitStage implements IQueryStage {
    async execute(data: any[], config: number) { return data.slice(0, config); }
    validate(config: any): void {
        if (!config || typeof config !== 'number') {
            throw new Error("$LimitStage requiere un número");
        }
    }
}