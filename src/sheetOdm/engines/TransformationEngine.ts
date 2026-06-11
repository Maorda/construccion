import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ClassType } from '@sheetOdm/types/query.types.js';
import { deepClone } from '@sheetOdm/utils/helper.js';
import { ExpressionEngine } from '../pipelines/expression.engine.js';
import { ValidationEngine } from './ValidationEngine.js';


@Injectable()
export class TransformationEngine {
    private readonly logger = new Logger(TransformationEngine.name);

    constructor(
        private readonly expressionEngine: ExpressionEngine,
        private readonly validationEngine: ValidationEngine,

    ) { }

    /**
     * Punto de entrada único para cualquier operación de datos.
     * Orquesta el proceso de clonación, transformación y validación.
     */
    public apply<T extends object>(
        entityClass: ClassType<T>,
        data: any,
        currentRecord: any = {}
    ): Partial<T> {
        if (!entityClass) {
            throw new InternalServerErrorException('Falta "entityClass" para ejecutar la transformación.');
        }

        const errors: string[] = [];
        const clonedData = deepClone(data);

        // 1. Ejecutar el pipeline de transformaciones (Core logic)
        const transformedData = this.processPipeline(clonedData, currentRecord);

        // 2. Validar (Delegado a ValidationEngine)
        this.validationEngine.validate(entityClass, transformedData, errors);

        // 3. Manejo de errores
        if (errors.length > 0) {
            this.logger.warn(`[Validation Fault] Abortando en [${entityClass.name}]`);
            throw new InternalServerErrorException({
                message: `Errores de validación en [${entityClass.name}]`,
                errors,
            });
        }

        return transformedData;
    }

    /**
     * El core de las operaciones: $inc, $mul, etc.
     */
    private processPipeline(data: any, record: any): any {
        // Protección inicial
        if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

        for (const key in data) {
            if (!Object.prototype.hasOwnProperty.call(data, key)) continue;

            let value = data[key];

            // Si no es un objeto (o es un array), lo saltamos ya que no es un operador
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

            // ─── 0. Limpieza de $validate ───
            if ('$validate' in value) {
                value = value.value;
                data[key] = value;
                if (!value || typeof value !== 'object') continue;
            }

            // ─── 1. Operadores Atómicos ───
            const currentVal = record?.[key];

            // $inc: Incremento simple
            if ('$inc' in value) {
                const increment = Number(this.expressionEngine.evaluate(value.$inc, record)) || 0;
                data[key] = (Number(currentVal) || 0) + increment;
                continue;
            }

            // $mul: Multiplicación (sin alias heredados)
            if ('$mul' in value) {
                const factor = Number(this.expressionEngine.evaluate(value.$mul, record)) || 1;
                const base = Number(currentVal) || 0;
                data[key] = base * factor;
                continue;
            }

            // $minMax: Comparación
            if ('$minMax' in value) {
                const { value: targetExpr, type = 'max' } = value.$minMax;
                const target = Number(this.expressionEngine.evaluate(targetExpr, record)) || 0;
                const base = Number(currentVal);

                data[key] = isNaN(base)
                    ? target
                    : (type === 'min' ? Math.min(base, target) : Math.max(base, target));
                continue;
            }

            // ─── 2. Evaluación Genérica ───
            // Si no se procesó por un operador, es una expresión compleja
            data[key] = this.expressionEngine.evaluate(value, record);
        }

        return data;
    }
}