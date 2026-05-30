import { Injectable } from "@nestjs/common";
import { IQueryStage } from "@sheetOdm/engines/query/IPipelineStage";

@Injectable()
export class SkipStage implements IQueryStage {
    async execute(data: any[], config: number) { return data.slice(config); }
}