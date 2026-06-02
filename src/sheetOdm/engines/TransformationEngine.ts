import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ExpressionEngine } from '@sheetOdm/core/utils/expressionEngine';


@Injectable()
export class TransformationEngine {
    constructor(
        private readonly expressionEngine: ExpressionEngine,
        private readonly validationEngine: ValidationEngine
    ) { }

    /**
     * El único punto de entrada unificado.
     * Aplica cambios y valida en un solo flujo.
     */
    public apply<T extends object>(
        entityClass: ClassType<T>,
        data: any,
        currentRecord: any = {}
    ): Partial<T> {
        const clonedData = deepClone(data);
        const errors: string[] = [];

        // 1. Ejecutar pipeline de transformaciones
        const result = this.processPipeline(clonedData, currentRecord, errors);

        // 2. Ejecutar validaciones (ahora delegadas)
        this.validationEngine.validate(entityClass, result, errors);

        if (errors.length > 0) {
            throw new InternalServerErrorException({
                message: `Error procesando ${entityClass.name}`,
                errors,
            });
        }

        return result;
    }

    private processPipeline(data: any, record: any, errors: string[]): any {
        // ... aquí va tu lógica de recorrer propiedades ...
        // ... llama a expressionEngine para evaluar ...
        // ... (Tu lógica de $inc, $mul, etc, simplificada) ...
        return data;
    }
}