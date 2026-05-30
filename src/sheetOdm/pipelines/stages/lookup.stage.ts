import { Injectable } from "@nestjs/common";
import { IQueryStage } from "@sheetOdm/engines/query/IPipelineStage";

import { LookupConfig } from "../types";


@Injectable()
export class LookupStage implements IQueryStage {
    constructor(private readonly engine: RelationEngine) { }
    async execute(data: any[], config: LookupConfig) {
        // Asumiendo que el repositorio se pasa por contexto o lógica externa
        return await this.engine.applyLookup(data, config as any);
    }
}