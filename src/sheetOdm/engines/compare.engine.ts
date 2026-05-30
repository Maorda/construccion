import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { ExpressionEngine } from "./expression.engine";
import { FilterQuery } from "@sheetOdm/types/query.types";


@Injectable()
export class CompareEngine {
    constructor(
        private readonly expressionEngine: ExpressionEngine,

    ) { }

    /**
     * EVALUADOR DE FILTROS (Punto de entrada)
     * Mejora: Uso de bucles for...of y extracción de lógica estática para maximizar velocidad.
     */
    public applyFilter<T extends Record<string, any>>(record: T, filter: FilterQuery<T>): boolean {
        // 1. Short-circuit: Si no hay filtro, el registro es totalmente válido.
        if (!filter || Object.keys(filter).length === 0) return true;

        // 2. Procesamos cada una de las condiciones del filtro (claves del objeto)
        for (const key of Object.keys(filter)) {
            const filterValue = (filter as any)[key];

            // --- CASO A: OPERADORES LÓGICOS EN LA RAÍZ ($and, $or, $not) ---
            if (key === '$and' && Array.isArray(filterValue)) {
                if (!filterValue.every(subFilter => this.applyFilter(record, subFilter))) {
                    return false;
                }
                continue;
            }

            if (key === '$or' && Array.isArray(filterValue)) {
                if (!filterValue.some(subFilter => this.applyFilter(record, subFilter))) {
                    return false;
                }
                continue;
            }

            if (key === '$not' && typeof filterValue === 'object') {
                if (this.applyFilter(record, filterValue)) {
                    return false;
                }
                continue;
            }

            // --- CASO B: EVALUACIÓN DE PROPIEDADES DIRECTAS O CON OPERADORES DE CAMPO ---
            if (filterValue && typeof filterValue === 'object' && !Array.isArray(filterValue)) {

                // Si el valor del filtro es un objeto (ej: { $gt: 500 }), evaluamos sus operadores internos
                for (const operator of Object.keys(filterValue)) {
                    // Validamos que sea un operador válido del motor (que empiece con '$')
                    if (!operator.startsWith('$')) continue;

                    const targetValue = filterValue[operator];

                    // 🟢 SOLUCIÓN ARQUITECTÓNICA: Construimos una micro-expresión para el ExpressionEngine
                    // En lugar de buscar handlers externos con 'as any', le pasamos la estructura al motor central
                    // Ejemplo: { $gt: [ "$saldo", 500 ] }
                    const microExpression = {
                        [operator]: [`$` + key, targetValue]
                    };

                    // Si el motor de expresiones evalúa que la condición es falsa, el registro no pasa el filtro
                    if (!this.expressionEngine.evaluate(microExpression, record)) {
                        return false;
                    }
                }
            } else {
                // Comparación directa de igualdad si no es un objeto de consulta (ej: { estado: 'ACTIVO' })
                // Validamos dinámicamente si los valores apuntan a columnas o fórmulas
                const resolvedRecordVal = this.expressionEngine.evaluate(`$` + key, record);
                const resolvedFilterVal = this.expressionEngine.evaluate(filterValue, record);

                if (resolvedRecordVal !== resolvedFilterVal) {
                    return false;
                }
            }
        }

        // Si superó todas las iteraciones, el registro coincide con la búsqueda
        return true;
    }
    /**
 * Ordena un array de registros basándose en uno o varios campos.
 * @param records El array de datos traídos de Sheets.
 * @param sortOptions Un objeto tipo { presupuesto: -1, nombre: 1 }
 * 1 = Ascendente, -1 = Descendente
 */
    applySort(records: any[], sortOptions: Record<string, 1 | -1>): any[] {
        if (!sortOptions || Object.keys(sortOptions).length === 0) return records;

        return [...records].sort((a, b) => {
            for (const key in sortOptions) {
                const direction = sortOptions[key];
                const valA = a[key];
                const valB = b[key];

                if (valA === valB) continue;

                // Lógica de comparación universal (Soporta números, strings y fechas)
                if (valA > valB) return direction === 1 ? 1 : -1;
                if (valA < valB) return direction === 1 ? -1 : 1;
            }
            return 0;
        });
    }

    /**
 * Aplica recortes al array de resultados (Paginación).
 * @param records El array (ya filtrado y ordenado).
 * @param limit Cantidad máxima de registros a devolver.
 * @param skip Cantidad de registros a saltar (offset).
 */
    applyPagination(records: any[], limit?: number, skip?: number): any[] {
        let startIndex = skip || 0;
        let endIndex = records.length;

        if (limit !== undefined) {
            endIndex = startIndex + limit;
        }

        return records.slice(startIndex, endIndex);
    }

}