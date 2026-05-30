import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { ExpressionEngine } from "./expression.engine";
import { FilterQuery } from "@sheetOdm/types/query.types";


@Injectable()
export class CompareEngine {
    constructor(
        private readonly expressionEngine: ExpressionEngine,

    ) { }

    public evaluateValue(fieldValue: any, condition: any): boolean {
        // 1. Caso Base: Igualdad directa con valores primitivos (ej: { estado: 'ACTIVO' })
        if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
            return fieldValue === condition;
        }

        // 2. Si la condición es un objeto con operadores (ej: { $gt: 18, $lt: 65 })
        for (const operator of Object.keys(condition)) {
            const targetValue = condition[operator];

            switch (operator) {
                case '$eq':
                    if (fieldValue !== targetValue) return false;
                    break;
                case '$ne':
                    if (fieldValue === targetValue) return false;
                    break;
                case '$gt':
                    if (fieldValue <= targetValue) return false;
                    break;
                case '$gte':
                    if (fieldValue < targetValue) return false;
                    break;
                case '$lt':
                    if (fieldValue >= targetValue) return false;
                    break;
                case '$lte':
                    if (fieldValue > targetValue) return false;
                    break;
                case '$in':
                    if (!Array.isArray(targetValue) || !targetValue.includes(fieldValue)) return false;
                    break;
                case '$nin':
                    if (Array.isArray(targetValue) && targetValue.includes(fieldValue)) return false;
                    break;
                case '$exists':
                    const isNullOrUndefined = fieldValue === undefined || fieldValue === null || String(fieldValue).trim() === '';
                    const expectedExists = Boolean(targetValue);
                    // Si espera que exista y es nulo, falla. Si espera que NO exista y tiene valor, falla.
                    if (expectedExists === isNullOrUndefined) return false;
                    break;
                case '$regex':
                    // Soporta tanto RegExp nativos como strings (ej: { $regex: "^Juan", $options: "i" })
                    const flags = condition['$options'] || 'i';
                    const regex = targetValue instanceof RegExp ? targetValue : new RegExp(targetValue, flags);
                    if (!regex.test(String(fieldValue ?? ''))) return false;
                    break;
                case '$options':
                    // Lo ignoramos aquí porque se procesa junto con $regex
                    break;
                default:
                    // Fallback de seguridad por si envían operadores no contemplados
                    if (operator.startsWith('$')) {
                        console.warn(`[CompareEngine] Operador de consulta no soportado: ${operator}`);
                        return false;
                    }
                    break;
            }
        }

        // 3. Si superó todos los operadores del objeto (ej: fue mayor que 18 Y menor que 30)
        return true;
    }

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