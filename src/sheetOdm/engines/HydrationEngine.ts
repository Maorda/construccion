import { Injectable, Logger } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { ClassType } from '@sheetOdm/types/query.types';

@Injectable()
export class HydrationEngine {
    private readonly logger = new Logger(HydrationEngine.name);

    constructor(private readonly metadataRegistry: MetadataRegistry) { }

    /**
     * Convierte datos crudos de la hoja a tipos de TS/JS definidos en metadata.
     */
    public hydrate<T extends object>(entityClass: ClassType<T>, rawRow: any): T {
        if (!rawRow || typeof rawRow !== 'object') return rawRow;

        const hydrated = { ...rawRow };
        const columnsMetadata = this.metadataRegistry.getColumnDetails(entityClass);
        if (!columnsMetadata) return hydrated as T;

        for (const key in hydrated) {
            const value = hydrated[key];
            if (value === null || value === undefined || value === '') continue;

            const colMeta = columnsMetadata[key];
            if (!colMeta || !colMeta.type) continue;

            hydrated[key] = this.castValue(value, colMeta.type);
        }

        return hydrated as T;
    }

    /**
     * Prepara el objeto para ser enviado a Google Sheets (Serialización inversa).
     */
    public serialize(data: any): any {
        const serialized = { ...data };
        for (const key in serialized) {
            const value = serialized[key];
            if (value instanceof Date) {
                serialized[key] = value.toISOString();
            } else if (typeof value === 'object' && value !== null) {
                serialized[key] = JSON.stringify(value);
            }
        }
        return serialized;
    }

    private castValue(value: any, targetType: any): any {
        try {
            if (targetType === Date || targetType === 'date') {
                const date = new Date(value);
                return isNaN(date.getTime()) ? value : date;
            }
            if (targetType === Number || targetType === 'number') {
                const num = Number(value);
                return isNaN(num) ? value : num;
            }
            if (targetType === Boolean || targetType === 'boolean') {
                return String(value).toLowerCase() === 'true' || value === '1' || value === 1 || value === true;
            }
            if (['json', 'JSON', 'Array', 'Object'].includes(targetType)) {
                if (typeof value === 'string') {
                    const trimmed = value.trim();
                    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                        return JSON.parse(trimmed);
                    }
                }
            }
        } catch (e) {
            this.logger.warn(`Error hidratando valor: ${value} a tipo ${targetType}`);
        }
        return value;
    }
}