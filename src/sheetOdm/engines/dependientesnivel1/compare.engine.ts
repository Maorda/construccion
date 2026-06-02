import { Injectable } from "@nestjs/common";

import { FilterQuery } from "@sheetOdm/types/query.types";


@Injectable()
export class CompareEngine {
    constructor(


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



}