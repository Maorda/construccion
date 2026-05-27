import { Injectable } from '@nestjs/common';
import { ComparisonOperators } from '@sheetOdm/types/query.types';

@Injectable()
export class CompareEngine {
    /**
     * Evalúa si un valor de registro satisface una condición de filtro (directa o con operadores).
     */
    evaluateValue(itemValue: any, filterCondition: any): boolean {
        // Si la condición de filtro no es un objeto o es nula, o es una fecha, hacemos comparación directa
        if (
            filterCondition === null ||
            filterCondition === undefined ||
            typeof filterCondition !== 'object' ||
            filterCondition instanceof Date ||
            Array.isArray(filterCondition)
        ) {
            return this.equals(itemValue, filterCondition);
        }

        // Si es un objeto de operadores ($gt, $lt, etc.)
        const keys = Object.keys(filterCondition);
        const hasOperators = keys.some(key => key.startsWith('$'));

        if (!hasOperators) {
            // Comparación directa de objetos (POJO)
            return this.equals(itemValue, filterCondition);
        }

        for (const op of keys) {
            const conditionValue = filterCondition[op];

            switch (op) {
                case '$eq':
                    if (!this.equals(itemValue, conditionValue)) return false;
                    break;
                case '$ne':
                    if (this.equals(itemValue, conditionValue)) return false;
                    break;
                case '$gt':
                    if (!(itemValue > conditionValue)) return false;
                    break;
                case '$gte':
                    if (!(itemValue >= conditionValue)) return false;
                    break;
                case '$lt':
                    if (!(itemValue < conditionValue)) return false;
                    break;
                case '$lte':
                    if (!(itemValue <= conditionValue)) return false;
                    break;
                case '$in':
                    if (!Array.isArray(conditionValue)) return false;
                    if (!conditionValue.some(val => this.equals(itemValue, val))) return false;
                    break;
                case '$nin':
                    if (!Array.isArray(conditionValue)) return false;
                    if (conditionValue.some(val => this.equals(itemValue, val))) return false;
                    break;
                case '$exists':
                    const exists = itemValue !== undefined && itemValue !== null;
                    if (exists !== !!conditionValue) return false;
                    break;
                case '$regex':
                    if (typeof itemValue !== 'string') return false;
                    const flags = filterCondition.$options || '';
                    const regex = new RegExp(conditionValue, flags);
                    if (!regex.test(itemValue)) return false;
                    break;
                case '$options':
                    // Se procesa junto con $regex
                    break;
                default:
                    // Operador desconocido
                    return false;
            }
        }

        return true;
    }

    private equals(a: any, b: any): boolean {
        if (a === b) return true;

        // Comparación flexible de tipos simples (ej. número contra string numérico)
        if (typeof a === 'number' && typeof b === 'string') {
            return a === Number(b);
        }
        if (typeof a === 'string' && typeof b === 'number') {
            return Number(a) === b;
        }

        // Comparación de booleanos flexibles
        if (typeof a === 'boolean' && (typeof b === 'string' || typeof b === 'number')) {
            const bBool = b === 'true' || b === 'TRUE' || b === 1 || b === '1';
            return a === bBool;
        }
        if ((typeof a === 'string' || typeof a === 'number') && typeof b === 'boolean') {
            const aBool = a === 'true' || a === 'TRUE' || a === 1 || a === '1';
            return aBool === b;
        }

        // Fechas
        if (a instanceof Date && b instanceof Date) {
            return a.getTime() === b.getTime();
        }
        if (a instanceof Date && typeof b === 'string') {
            return a.getTime() === new Date(b).getTime();
        }
        if (typeof a === 'string' && b instanceof Date) {
            return new Date(a).getTime() === b.getTime();
        }

        return false;
    }
}
