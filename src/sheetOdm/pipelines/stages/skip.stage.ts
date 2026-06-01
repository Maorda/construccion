import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages";

@Injectable()
export class SkipStage implements IQueryStage {
    async execute(data: any[], config: number) { return data.slice(config); }
    validate(config: any): void {
        if (!config || typeof config !== 'number') {
            throw new Error("$Skip requiere un número");
        }
    }
}