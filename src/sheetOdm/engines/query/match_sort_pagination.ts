import { Injectable } from "@nestjs/common";
import { CompareEngine } from "../compare.engine";
import { IQueryStage } from "./IPipelineStage";

@Injectable()
export class MatchStage implements IQueryStage {
  constructor(private readonly engine: CompareEngine) { }
  execute(data: any[], config: any) {
    return data.filter(item => this.engine.applyFilter(item, config));
  }
}

@Injectable()
export class SortStage implements IQueryStage {
  constructor(private readonly engine: CompareEngine) { }
  execute(data: any[], config: any) {
    return this.engine.applySort(data, config);
  }
}