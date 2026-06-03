import { Injectable, Logger } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { ClassType } from '@sheetOdm/types/query.types';

@Injectable()
export class HydrationEngine {
    private readonly logger = new Logger(HydrationEngine.name);

    constructor(private readonly metadataRegistry: MetadataRegistry) { }

    public hydrate<T extends object>(entityClass: ClassType<T>, rawRow: any): T {
        if (!rawRow || typeof rawRow !== 'object') return rawRow;

        const hydrated = { ...rawRow };
        // Usamos el esquema cacheado para máxima velocidad
        const columnsMetadata = this.metadataRegistry.getSchema(entityClass).columns;
        if (!columnsMetadata) return hydrated as T;

        for (const key in hydrated) {
            const value = hydrated[key];
            // Permitimos pasar valores falsy como el número 0 o booleanos falsos
            if (value === null || value === undefined || value === '') continue;

            const colMeta = columnsMetadata[key];
            if (!colMeta || !colMeta.type) continue;

            hydrated[key] = this.castValue(value, colMeta.type);
        }

        return hydrated as T;
    }

    public serialize(data: any): any {
        const serialized = { ...data };
        for (const key in serialized) {
            const value = serialized[key];
            if (value instanceof Date) {
                // ISO String para uniformidad en la hoja de cálculo
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
                // Removemos posibles comas de miles antes de parsear si viene como string
                const cleanStr = typeof value === 'string' ? value.replace(/,/g, '') : value;
                const num = Number(cleanStr);
                return isNaN(num) ? value : num;
            }
            if (targetType === Boolean || targetType === 'boolean') {
                if (typeof value === 'boolean') return value;
                const str = String(value).toLowerCase().trim();
                // Soportamos 'verdadero' por si el locale de Sheets está en español
                return str === 'true' || str === 'verdadero' || str === '1';
            }
            if (['json', 'array', 'object'].includes(String(targetType).toLowerCase())) {
                if (typeof value === 'string') {
                    const trimmed = value.trim();
                    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
                        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                        return JSON.parse(trimmed);
                    }
                }
            }
        } catch (e: any) {
            this.logger.warn(`Error hidratando valor "${value}" a tipo ${targetType}: ${e.message}`);
        }
        return value; // Fallback al valor crudo si falla el casteo
    }
}