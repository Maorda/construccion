import { Injectable } from "@nestjs/common";
import { ClassType } from "@sheetOdm/types/query.types";
import { MetadataRegistry } from "./metadata-registry.service";

@Injectable()
export class ValidationEngine {
    constructor(private readonly metadataRegistry: MetadataRegistry) { }

    /**
     * Valida los datos basándose en los metadatos registrados de la entidad.
     */
    public validate<T>(entityClass: ClassType<T>, data: any, errors: string[]): void {
        const columnsMetadata = this.metadataRegistry.getColumnDetails(entityClass);
        if (!columnsMetadata) return;

        for (const [key, value] of Object.entries(data)) {
            const fieldMeta = columnsMetadata[key];

            // Si el campo no tiene reglas de validación en los metadatos, saltamos
            if (!fieldMeta || !fieldMeta.validation) continue;

            // Ejecutamos la lógica de validación usando tu utilidad existente
            this.runFieldValidation(key, value, fieldMeta.validation, errors);
        }
    }

    private runFieldValidation(fieldName: string, value: any, rules: any, errors: string[]) {
        // Aquí centralizas las llamadas a ValidationHandleUtil
        // Ejemplo simplificado:
        if (rules.required && ValidationHandleUtil.ValidationHandlers.required(value)) {
            errors.push(`${fieldName}: Es obligatorio.`);
        }

        if (rules.min !== undefined && value < rules.min) {
            errors.push(`${fieldName}: Valor menor al mínimo permitido (${rules.min}).`);
        }

        // ... resto de tus validaciones (email, pattern, isDate, etc.)
    }
}