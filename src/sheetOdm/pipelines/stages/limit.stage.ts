import { Injectable } from "@nestjs/common";
import { IQueryStage } from "@sheetOdm/engines/query/IPipelineStage";

@Injectable()
export class LimitStage implements IQueryStage {
    async execute(data: any[], config: number) { return data.slice(0, config); }
}