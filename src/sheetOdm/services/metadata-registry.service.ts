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
    SHEETS_TABLE_NAME,
    SHEETS_VERSION_FIELD,
    SHEETS_VIRTUALS
} from '@sheetOdm/constants/metadata.constants';
import { ClassType } from '@sheetOdm/types/query.types';

export interface EntitySchema {
    sheetName: string;
    primaryKey: string;
    primaryKeyColumnName: string;
    columns: Record<string, ColumnOptions>;
    columnList: string[];
    deleteControl: string | null;
    versionField: string | null;
    relations: string[];
    virtuals: any[];
}

@Injectable()
export class MetadataRegistry {
    private readonly schemaCache = new Map<Function, EntitySchema>();
    private static readonly registeredEntitiesStore = new Set<ClassType<any>>();

    // --- MÉTODOS PÚBLICOS (Ahora son lecturas instantáneas de memoria) ---

    getPrimaryKeyField<T extends object>(entityClass: ClassType<T>): string {
        const cached = this.schemaCache.get(entityClass);
        if (cached) return cached.primaryKey;

        return this.compileSchema(entityClass).primaryKey;
    }



    getPrimaryKeySheetName<T extends object>(entityClass: ClassType<T>): string {
        return this.compileSchema(entityClass).primaryKeyColumnName;
    }

    getColumnDetails(entityClass: ClassType<any>): Record<string, ColumnOptions> {
        return this.compileSchema(entityClass).columns;
    }

    getColumnMap(entityClass: ClassType<any>): Record<string, number> {
        const schema = this.getSchema(entityClass);
        const map: Record<string, number> = {};
        schema.columnList.forEach((colName, index) => { map[colName] = index; });
        return map;
    }

    getDeleteControlProperty<T extends object>(entityClass: ClassType<T>): string | null {
        const cached = this.schemaCache.get(entityClass);
        if (cached) return cached.deleteControl;

        return this.compileSchema(entityClass).deleteControl;
    }



    getRelationsList<T extends object>(entityClass: ClassType<T>): string[] {
        return this.compileSchema(entityClass).relations;
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

    getRelationOptions(entityClass: ClassType<any>, relationName: string): any {
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
    getVersionField<T extends object>(entityClass: ClassType<T>): string | null {
        // Busca en los metadatos globales de la clase el campo marcado con @Version()
        return Reflect.getMetadata(SHEETS_VERSION_FIELD, entityClass) || null;
    }
    getColumnList<T extends object>(entityClass: ClassType<T>): string[] {
        return this.compileSchema(entityClass).columnList;
    }

    public getSchema(entityClass: ClassType): EntitySchema {
        if (this.schemaCache.has(entityClass)) {
            return this.schemaCache.get(entityClass)!;
        }

        // 🏗️ Compilación del esquema (Se ejecuta UNA sola vez por entidad)
        const schema = this.compileSchema(entityClass);
        this.schemaCache.set(entityClass, schema);

        return schema;
    }


    private compileSchema(entityClass: ClassType<any>): EntitySchema {
        const proto = entityClass.prototype;

        return {
            sheetName: (Reflect.getMetadata(SHEETS_TABLE_NAME, entityClass) || entityClass.name).toUpperCase(),
            primaryKey: Reflect.getMetadata(SHEETS_PRIMARY_KEY, entityClass) || 'id',
            primaryKeyColumnName: getPrimaryKeyColumnName(entityClass) || 'ID',
            columns: Reflect.getMetadata(SHEETS_COLUMN_DETAILS, entityClass) || {},
            columnList: Reflect.getMetadata(SHEETS_COLUMN_LIST, entityClass) || [],
            deleteControl: Reflect.getMetadata(SHEETS_DELETE_CONTROL, entityClass) || null,
            versionField: Reflect.getMetadata(SHEETS_VERSION_FIELD, entityClass) || null,
            relations: Reflect.getMetadata(SHEETS_RELATIONS_LIST, proto) || [],
            virtuals: Reflect.getMetadata(SHEETS_VIRTUALS, entityClass) || []
        };
    }



}
