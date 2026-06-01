import { Injectable } from "@nestjs/common";
import { ExpressionEngine } from "../expression.engine";
import { IQueryStage } from "@sheetOdm/pipelines/stages/IqueryStages";

@Injectable()
export class ProjectStage implements IQueryStage {
  constructor(private readonly engine: ExpressionEngine) { }
  execute(data: any[], config: any) {
    return data.map(item => this.engine.execute(item, config));
  }
  validate(config: any): void {
    if (!config || typeof config !== 'object') {
      throw new Error("$ProjectStage requiere un objeto de configuración");
    }
    // ... lógica de validación adicional si la necesitas
  }
}