import { Injectable } from '@nestjs/common';
import { CompareEngine } from './compare.engine';

@Injectable()
export class ExpressionEngine {
    constructor(private readonly compareEngine: CompareEngine) {}

    /**
     * Evalúa un filtro completo sobre un objeto de registro.
     */
    evaluateFilter<T extends object>(item: T, filter: any): boolean {
        if (!filter || Object.keys(filter).length === 0) {
            return true;
        }

        for (const key of Object.keys(filter)) {
            const condition = filter[key];

            // 1. Operadores lógicos de nivel raíz
            if (key === '$and') {
                if (!Array.isArray(condition)) return false;
                if (!condition.every(subFilter => this.evaluateFilter(item, subFilter))) return false;
                continue;
            }

            if (key === '$or') {
                if (!Array.isArray(condition)) return false;
                if (!condition.some(subFilter => this.evaluateFilter(item, subFilter))) return false;
                continue;
            }

            if (key === '$nor') {
                if (!Array.isArray(condition)) return false;
                if (condition.some(subFilter => this.evaluateFilter(item, subFilter))) return false;
                continue;
            }

            if (key === '$not') {
                if (typeof condition !== 'object') return false;
                if (this.evaluateFilter(item, condition)) return false;
                continue;
            }

            // 2. Rutas anidadas o propiedades simples (ej: 'edad' o 'obrero.dni')
            const value = this.getNestedValue(item, key);
            if (!this.compareEngine.evaluateValue(value, condition)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Resuelve valores para propiedades anidadas utilizando notación de puntos.
     * Ejemplo: getNestedValue({ obrero: { dni: '123' } }, 'obrero.dni') -> '123'
     */
    private getNestedValue(obj: any, path: string): any {
        if (!obj) return undefined;
        if (!path.includes('.')) return obj[path];

        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[part];
        }

        return current;
    }
}
