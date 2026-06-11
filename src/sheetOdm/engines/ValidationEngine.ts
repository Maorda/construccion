import { Injectable, Logger } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service.js';
import { ClassType } from '@sheetOdm/types/query.types.js';
import { ValidationHandleUtil } from '@sheetOdm/utils/validation-handle.util.js';


@Injectable()
export class ValidationEngine {
    private readonly logger = new Logger(ValidationEngine.name);

    constructor(private readonly metadataRegistry: MetadataRegistry) { }

    /**
     * Valida un objeto de datos contra los metadatos de la entidad.
     */
    public validate<T>(entityClass: ClassType<T>, data: any, errors: string[]): void {
        const columnsMetadata = this.metadataRegistry.getColumnDetails(entityClass);
        if (!columnsMetadata) return;

        for (const [key, value] of Object.entries(data)) {
            const colMeta = columnsMetadata[key];

            // Si el campo tiene configuración de validación, la ejecutamos
            if (colMeta && colMeta.validation) {
                this.runFieldValidation(key, value, colMeta.validation, errors);
            }
        }
    }

    private runFieldValidation(fieldName: string, currentVal: any, config: any, errors: string[]) {
        try {
            // Reutilizamos tu lógica existente de ValidationHandleUtil
            if (config.required) {
                const res = ValidationHandleUtil.ValidationHandlers.required(currentVal);
                if (typeof res === 'string') {
                    errors.push(`${fieldName}: ${res}`);
                    return; // Short-circuit
                }
            }

            if (currentVal === null || currentVal === undefined || currentVal === '') return;

            // Mapeo de reglas a handlers
            if (config.min !== undefined) this.check(fieldName, ValidationHandleUtil.ValidationHandlers.min(currentVal, config.min), errors);
            if (config.max !== undefined) this.check(fieldName, ValidationHandleUtil.ValidationHandlers.max(currentVal, config.max), errors);

            // Longitudes
            if (config.minLength && String(currentVal).length < config.minLength) errors.push(`${fieldName}: Mínimo ${config.minLength} caracteres.`);
            if (config.maxLength && String(currentVal).length > config.maxLength) errors.push(`${fieldName}: Máximo ${config.maxLength} caracteres.`);

            // Email
            if (config.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(currentVal))) errors.push(`${fieldName}: Email inválido.`);

            // Patrones
            if (config.pattern instanceof RegExp && !config.pattern.test(String(currentVal))) errors.push(`${fieldName}: Formato inválido.`);

            // Enum
            if (config.in && Array.isArray(config.in) && !config.in.includes(currentVal)) errors.push(`${fieldName}: Debe ser uno de: ${config.in.join(', ')}.`);

            // Especiales (Fecha / Moneda)
            if (config.isDate && isNaN(new Date(currentVal).getTime())) errors.push(`${fieldName}: Fecha no válida.`);
            if (config.isSoles) {
                const num = Number(currentVal);
                if (isNaN(num) || num < 0) errors.push(`${fieldName}: Monto inválido.`);
            }
        } catch (e) {
            this.logger.error(`Error en validación de campo ${fieldName}: ${e.message}`);
        }
    }

    private check(field: string, result: string | boolean, errors: string[]) {
        if (typeof result === 'string') errors.push(`${field}: ${result}`);
    }
}