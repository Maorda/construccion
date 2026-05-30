import { Injectable } from '@nestjs/common';
import { ColumnOptions } from '@sheetOdm/decorators/column.decorator';
import { getPrimaryKeyColumnName } from '@sheetOdm/decorators/primarykey.decorator';

import {
    SHEETS_PRIMARY_KEY,
    SHEETS_COLUMN_DETAILS,
    SHEETS_ALL_RELATIONS,
    SHEETS_COLUMN_LIST,
    SHEETS_DELETE_CONTROL,
    SHEETS_RELATIONS_LIST,
    SHEETS_TABLE_NAME
} from '@sheetOdm/constants/metadata.constants';
import { ClassType } from '@sheetOdm/types/query.types';

interface EntitySchema {
    sheetName: string;
    primaryKey: string;
    primaryKeyColumnName: string;
    columns: Record<string, ColumnOptions>;
    columnList: string[];
    deleteControl: string | null;
    relations: string[];
}

@Injectable()
export class MetadataRegistry {
    private readonly schemaCache = new Map<Function, EntitySchema>();
    private static readonly registeredEntitiesStore = new Set<ClassType<any>>();

    /**
     * Centralizador: Construye el esquema completo solo la primera vez.
     */
    private ensureMetadata(entityClass: ClassType<any>): EntitySchema {
        if (!this.schemaCache.has(entityClass)) {
            const proto = entityClass.prototype;

            // Aquí "compilas" la metadata una única vez
            const schema: EntitySchema = {
                sheetName: Reflect.getMetadata(SHEETS_TABLE_NAME, entityClass) || entityClass.name.toUpperCase(),
                primaryKey: Reflect.getMetadata(SHEETS_PRIMARY_KEY, entityClass) || 'id',
                primaryKeyColumnName: getPrimaryKeyColumnName(entityClass) || 'ID',
                columns: Reflect.getMetadata(SHEETS_COLUMN_DETAILS, entityClass) || {},
                columnList: Reflect.getMetadata(SHEETS_COLUMN_LIST, entityClass) || [],
                deleteControl: Reflect.getMetadata(SHEETS_DELETE_CONTROL, entityClass) || null,
                relations: Reflect.getMetadata(SHEETS_RELATIONS_LIST, proto) || []
            };

            this.schemaCache.set(entityClass, schema);
        }
        return this.schemaCache.get(entityClass)!;
    }

    // --- MÉTODOS PÚBLICOS (Ahora son lecturas instantáneas de memoria) ---

    getPrimaryKeyField<T extends object>(entityClass: ClassType<T>): string {
        return this.ensureMetadata(entityClass).primaryKey;
    }

    getPrimaryKeySheetName<T extends object>(entityClass: ClassType<T>): string {
        return this.ensureMetadata(entityClass).primaryKeyColumnName;
    }

    getColumnDetails<T extends object>(entityClass: ClassType<T>): Record<string, ColumnOptions> {
        return this.ensureMetadata(entityClass).columns;
    }

    getColumnMap<T extends object>(entityClass: ClassType<T>): Record<string, number> {
        const schema = this.ensureMetadata(entityClass);
        const map: Record<string, number> = {};
        schema.columnList.forEach((colName, index) => {
            map[colName] = index;
        });
        return map;
    }

    getDeleteControlProperty<T extends object>(entityClass: ClassType<T>): string | null {
        return this.ensureMetadata(entityClass).deleteControl;
    }

    getRelationsList<T extends object>(entityClass: ClassType<T>): string[] {
        return this.ensureMetadata(entityClass).relations;
    }

    // --- Métodos que requieren lógica dinámica (No se pueden cachear estáticamente) ---

    getColumnOptions<T extends object>(entityClass: ClassType<T>, path: string): ColumnOptions | undefined {
        const details = this.getColumnDetails(entityClass);
        if (!path.includes('.')) return details[path];
        return this.resolveDeepMetadata(entityClass, path.split('.'));
    }

    private resolveDeepMetadata(targetClass: ClassType<any>, parts: string[]): ColumnOptions | undefined {
        let currentTarget = targetClass;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const details = this.getColumnDetails(currentTarget);
            if (i === parts.length - 1) return details[part];

            const relOptions = Reflect.getMetadata(SHEETS_ALL_RELATIONS, currentTarget.prototype, part) ||
                Reflect.getMetadata(SHEETS_ALL_RELATIONS, currentTarget, part);

            if (relOptions?.targetEntity) {
                currentTarget = relOptions.targetEntity();
            } else {
                return undefined;
            }
        }
        return undefined;
    }

    getRelationOptions<T extends object>(entityClass: ClassType<T>, relationName: string): any {
        return Reflect.getMetadata(SHEETS_ALL_RELATIONS, entityClass.prototype, relationName) ||
            Reflect.getMetadata(SHEETS_ALL_RELATIONS, entityClass, relationName);
    }

    // --- Registro Estático ---
    static register(target: ClassType<any>): void {
        this.registeredEntitiesStore.add(target);
    }

    static getAllRegisteredEntities(): ClassType<any>[] {
        return Array.from(this.registeredEntitiesStore);
    }

}
