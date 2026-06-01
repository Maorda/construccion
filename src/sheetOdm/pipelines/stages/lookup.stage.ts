import { Injectable } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages";

import { LookupConfig } from "../types";
import { RelationEngine } from "@sheetOdm/engines/relationEngine";


@Injectable()
export class LookupStage implements IQueryStage {
    constructor(private readonly engine: RelationEngine) { }

    async execute(data: any[], config: LookupConfig) {
        return await this.engine.applyLookup(data, config as any);
    }

    validate(config: any): void {
        // 1. Validar tipo
        if (!config || typeof config !== 'object') {
            throw new Error("$lookup requiere un objeto de configuración");
        }

        // 2. Validar propiedades obligatorias
        const required = ['from', 'localField', 'foreignField', 'as'];
        for (const field of required) {
            if (!config[field]) {
                throw new Error(`$lookup mal configurado: falta la propiedad obligatoria '${field}'`);
            }
        }

        // Opcional: validación de tipos específicos
        if (typeof config.from !== 'string') {
            throw new Error("$lookup: 'from' debe ser un string (nombre de la colección/hoja)");
        }
    }
}