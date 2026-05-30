import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./IPipelineStage";

@Injectable()
export class LookupStage implements IQueryStage {
  constructor(private readonly engine: RelationEngine) { }
  async execute(data: any[], config: any) {
    // config aquí debería traer el repositoryProvider si es dinámico
    return await this.engine.applyLookup(data, config);
  }
}