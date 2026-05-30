import { Injectable } from "@nestjs/common";
import { IQueryStage } from "@sheetOdm/engines/query/IPipelineStage";
import { CompareEngine } from "@sheetOdm/index";



@Injectable()
export class MatchStage implements IQueryStage {
    constructor(private readonly engine: CompareEngine) { }
    async execute(data: any[], config: any) {
        return data.filter(item => this.engine.applyFilter(item, config));
    }
}