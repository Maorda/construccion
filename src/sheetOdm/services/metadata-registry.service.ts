import { Injectable } from '@nestjs/common';
import { ColumnOptions } from '@sheetOdm/decorators/column.decorator';
import { getPrimaryKeyColumnName } from '@sheetOdm/decorators/primarykey.decorator';

import {
    SHEETS_PRIMARY_KEY,
    SHEETS_COLUMN_DETAILS,
    SHEETS_ALL_RELATIONS,
    SHEETS_COLUMN_LIST,
    SHEETS_DELETE_CONTROL,
    SHEETS_RELATIONS_LIST
} from '@sheetOdm/constants/metadata.constants';

@Injectable()
export class MetadataRegistry {
    private static cache = new Map<Function, any>();
    private static registeredEntities = new Set<Function>();
    /**
     * Obtiene el nombre de la propiedad TS (ej: 'id' o 'dni') marcada como PK.
     * Se busca directamente en la clase constructora.
     */
    getPrimaryKeyField(entityClass: any): string {
        const targetClass = typeof entityClass === 'function' ? entityClass : entityClass.constructor;
        return Reflect.getMetadata(SHEETS_PRIMARY_KEY, targetClass) || 'null';
    }

    /**
     * Obtiene el nombre real de la cabecera en Google Sheets para la PK.
     */
    getPrimaryKeySheetName(entityClass: any): string {
        const targetClass = typeof entityClass === 'function' ? entityClass : entityClass.constructor;
        return getPrimaryKeyColumnName(targetClass) || 'id';
    }

    /**
     * Obtiene la configuración de todas las columnas.
     * Lee directamente del mapa centralizado guardado en el Constructor de la Clase.
     */
    getColumnDetails(target: Function): Record<string, ColumnOptions> {
        const targetClass = typeof target === 'function' ? target : (target as any).constructor;

        if (MetadataRegistry.cache.has(targetClass)) {
            return MetadataRegistry.cache.get(targetClass);
        }

        const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, targetClass) || {};
        MetadataRegistry.cache.set(targetClass, details);
        return details;
    }

    /**
     * Obtiene las opciones de una columna específica por su path jerárquico.
     */
    getColumnOptions(target: any, path: string): ColumnOptions | undefined {
        if (!target || !path) return undefined;

        const targetClass = typeof target === 'function' ? target : target.constructor;
        const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, targetClass) || {};

        if (!path.includes('.')) {
            return details[path];
        }

        return this.resolveDeepMetadata(targetClass, path.split('.'));
    }

    /**
     * Resuelve metadatos navegando por las relaciones @SubCollection / @Relation
     */
    private resolveDeepMetadata(targetClass: any, parts: string[]): ColumnOptions | undefined {
        let currentTarget = targetClass;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;

            const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, currentTarget) || {};

            if (isLast) {
                return details[part];
            }

            // Las relaciones se guardan en el prototipo de la propiedad
            const relOptions = Reflect.getMetadata(SHEETS_ALL_RELATIONS, currentTarget.prototype, part);

            if (relOptions && relOptions.targetEntity) {
                currentTarget = relOptions.targetEntity(); // Saltamos a la clase constructora destino
            } else {
                return undefined;
            }
        }
        return undefined;
    }

    /**
     * Genera dinámicamente el mapa de índices posicionales { propertyName: columnIndex }
     * basándose en la lista ordenada real generada por el decorador @Column.
     */
    getColumnMap(entityClass: any): Record<string, number> {
        const targetClass = typeof entityClass === 'function' ? entityClass : entityClass.constructor;
        const orderedColumns: string[] = Reflect.getMetadata(SHEETS_COLUMN_LIST, targetClass) || [];

        const map: Record<string, number> = {};
        orderedColumns.forEach((colName, index) => {
            map[colName] = index;
        });

        return map;
    }

    /**
     * Obtiene el nombre de la propiedad usada para el Soft Delete (Control de Borrado).
     */
    getDeleteControlProperty(entityClass: any): string | null {
        const targetClass = typeof entityClass === 'function' ? entityClass : entityClass.constructor;
        return Reflect.getMetadata(SHEETS_DELETE_CONTROL, targetClass) || null;
    }

    /**
     * Obtiene la lista de todas las propiedades marcadas como relaciones (@SubCollection).
     */
    getRelationsList(entityClass: any): string[] {
        const targetClass = typeof entityClass === 'function' ? entityClass : entityClass.constructor;
        return Reflect.getMetadata(SHEETS_RELATIONS_LIST, targetClass.prototype) || [];
    }

    /**
     * Obtiene las opciones específicas de una relación.
     */
    getRelationOptions(entityClass: any, relationName: string): any {
        const targetClass = typeof entityClass === 'function' ? entityClass : entityClass.constructor;
        return Reflect.getMetadata(SHEETS_ALL_RELATIONS, targetClass.prototype, relationName);
    }

    // NUEVO: Catálogo interno
    private registeredEntities = new Set<Function>();

    // NUEVO: Método para que los decoradores se auto-registren
    registerEntity(entityClass: Function) {
        this.registeredEntities.add(entityClass);
    }

    // NUEVO: Método para auditoría
    getAllRegisteredEntities(): Function[] {
        return Array.from(this.registeredEntities);
    }

    static register(target: Function) {
        this.registeredEntities.add(target);
    }

    static getAllRegisteredEntities(): Function[] {
        return Array.from(this.registeredEntities);
    }
}
