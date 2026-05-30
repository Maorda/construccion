import { Injectable } from "@nestjs/common";
import { ExpressionEngine } from "@sheetOdm/engines/expression.engine";
import { IQueryStage } from "@sheetOdm/engines/query/IPipelineStage";

@Injectable()
export class ProjectStage implements IQueryStage {
    constructor(private readonly engine: ExpressionEngine) { }
    async execute(data: any[], config: any) {
        return data.map(item => this.engine.execute(item, config));
    }
}