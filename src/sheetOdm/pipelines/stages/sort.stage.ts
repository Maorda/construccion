import { Injectable } from "@nestjs/common";
import { CompareEngine } from "@sheetOdm/index";
import { IQueryStage } from "./IqueryStages";



@Injectable()
export class SortStage implements IQueryStage {
    public async execute(data: any[], config: Record<string, 1 | -1>): Promise<any[]> {
        if (!config || Object.keys(config).length === 0) return data;

        // Retornamos una copia mutada para no alterar el array en memoria del caché accidentalmente
        return [...data].sort((a, b) => {
            for (const key of Object.keys(config)) {
                const direction = config[key];
                const valA = a[key];
                const valB = b[key];

                if (valA === valB) continue;

                // 🛡️ PROTECCIÓN SHEETS: Manejo seguro de celdas vacías (las empuja al final)
                if (valA === undefined || valA === null || valA === '') return 1;
                if (valB === undefined || valB === null || valB === '') return -1;

                // 🗓️ Fechas: Comparación precisa basada en milisegundos
                if (valA instanceof Date && valB instanceof Date) {
                    return direction === 1
                        ? valA.getTime() - valB.getTime()
                        : valB.getTime() - valA.getTime();
                }

                // 🔤 Numérico y Alfabético
                if (valA > valB) return direction === 1 ? 1 : -1;
                if (valA < valB) return direction === 1 ? -1 : 1;
            }
            return 0;
        });
    }

    public validate(config: any): void {
        if (typeof config !== 'object' || Array.isArray(config)) {
            throw new Error('[SortStage] La configuración debe ser un objeto. Ejemplo: { edad: -1, nombre: 1 }');
        }
        for (const key of Object.keys(config)) {
            if (config[key] !== 1 && config[key] !== -1) {
                throw new Error(`[SortStage] El valor para ordenar "${key}" debe ser estrictamente 1 (asc) o -1 (desc).`);
            }
        }
    }
}