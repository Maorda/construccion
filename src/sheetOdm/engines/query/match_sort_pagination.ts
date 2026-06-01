import { Injectable } from "@nestjs/common";
import { CompareEngine } from "../dependientesnivel1/compare.engine";
import { IQueryStage } from "@sheetOdm/pipelines/stages/IqueryStages";


@Injectable()
export class MatchStage implements IQueryStage {
  constructor(private readonly engine: CompareEngine) { }
  execute(data: any[], config: any) {
    return data.filter(item => this.engine.applyFilter(item, config));
  }
  validate(config: any): void {
    if (!config || typeof config !== 'object') {
      throw new Error("$MatchStage requiere un objeto de configuración");
    }
    // ... lógica de validación adicional si la necesitas
  }

}

@Injectable()
export class SortStage implements IQueryStage {
  constructor(private readonly engine: CompareEngine) { }
  execute(data: any[], config: any) {
    return this.engine.applySort(data, config);
  }
  validate(config: any): void {
    if (!config || typeof config !== 'object') {
      throw new Error("$SortStage requiere un objeto de configuración");
    }
    // ... lógica de validación adicional si la necesitas
  }

}