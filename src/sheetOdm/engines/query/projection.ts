import { Injectable } from "@nestjs/common";
import { ExpressionEngine } from "../expression.engine";
import { IQueryStage } from "./IPipelineStage";

@Injectable()
export class ProjectStage implements IQueryStage {
  constructor(private readonly engine: ExpressionEngine) { }
  execute(data: any[], config: any) {
    return data.map(item => this.engine.execute(item, config));
  }
}