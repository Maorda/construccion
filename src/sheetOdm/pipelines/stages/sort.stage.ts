import { Injectable } from "@nestjs/common";
import { CompareEngine } from "@sheetOdm/index";
import { IQueryStage } from "@sheetOdm/engines/query/IPipelineStage";


@Injectable()
export class SortStage implements IQueryStage {
    constructor(private readonly engine: CompareEngine) { }
    async execute(data: any[], config: any) {
        return this.engine.applySort(data, config);
    }
}