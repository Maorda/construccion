import { Injectable, Logger } from "@nestjs/common";
import { ExpressionEngine } from "@sheetOdm/engines/expression.engine";
import { IQueryStage } from "@sheetOdm/engines/query/IPipelineStage";

export class AddFieldsStage implements IQueryStage {
    private readonly logger = new Logger(AddFieldsStage.name);

    constructor(private readonly engine: ExpressionEngine) { }

    async execute(data: any[], config: Record<string, any>): Promise<any[]> {
        // 1. Guardia de seguridad: Fallar rápido y silencioso si no hay configuración
        if (!config || typeof config !== 'object' || Object.keys(config).length === 0) {
            return data;
        }

        try {
            return data.map(item => {
                // 2. Extraer el valor base respetando wrappers (como en tu RelationEngine)
                const rawItem = item?.data ?? item?._snapshot ?? item;

                // 3. Evaluar los nuevos campos usando tu motor existente
                // evaluate() procesaría un solo campo, execute() procesa un objeto entero. 
                // execute() es el método correcto aquí.
                const newFields = this.engine.execute(rawItem, config);

                // 4. Retornar el objeto inmutable fusionado
                return {
                    ...item,
                    ...newFields
                };
            });
        } catch (error) {
            this.logger.error(`[AddFieldsStage] Error evaluando configuración: ${JSON.stringify(config)}`, error);
            // En una arquitectura robusta, si falla un campo adicional, devolvemos 
            // la data original para no tumbar toda la consulta por un cálculo menor.
            return data;
        }
    }
}
