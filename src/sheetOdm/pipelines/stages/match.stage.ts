import { Injectable, Logger } from "@nestjs/common";
import { IQueryStage } from "./IqueryStages";
import { CompareEngine } from "@sheetOdm/index";


@Injectable()
export class MatchStage implements IQueryStage {
    private readonly logger = new Logger(MatchStage.name);

    constructor(private readonly compareEngine: CompareEngine) { }

    public async execute(data: any[], filter: any): Promise<any[]> {
        // Ejecución síncrona, ya que filtrar en memoria no requiere I/O
        return data.filter(record => this.evaluateFilter(record, filter));
    }

    public validate(config: any): void {
        if (typeof config !== 'object' || Array.isArray(config)) {
            throw new Error('[MatchStage] La configuración de $match debe ser un objeto.');
        }
    }

    /**
     * Lógica movida desde ExpressionEngine.
     * Ahora el MatchStage es el dueño de la evaluación de condiciones.
     */
    private evaluateFilter(item: any, filter: any): boolean {
        if (!filter || Object.keys(filter).length === 0) {
            return true;
        }

        for (const key of Object.keys(filter)) {
            const condition = filter[key];

            // Operadores Lógicos
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

            // Filtrado de campo específico
            const value = this.getNestedValue(item, key);

            // Delegamos la comparación real al CompareEngine
            // (Esto mantiene la lógica de comparación atómica centralizada)
            if (!this.compareEngine.evaluateValue(value, condition)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Utilidad para acceder a propiedades anidadas (ej: "user.profile.name")
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