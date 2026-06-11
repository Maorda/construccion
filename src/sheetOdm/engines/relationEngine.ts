import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { SHEETS_TABLE_NAME, SHEETS_RELATIONS_LIST, SHEETS_ALL_RELATIONS } from '@sheetOdm/constants/metadata.constants.js';
import { RelationOptions } from '@sheetOdm/pipelines/types.js';

import { SheetsRepository } from '@sheetOdm/repository/sheets.repository.js';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service.js';
import { ClassType, FilterQuery } from '@sheetOdm/types/query.types.js';

@Injectable()
export class RelationEngine {
    private readonly logger = new Logger(RelationEngine.name);
    constructor(
        private readonly metadataRegistry: MetadataRegistry
    ) { }
    public async populate<T extends object>(
        data: T | T[],
        path: string,
        repositoryProvider: (entityClass: ClassType<any>) => SheetsRepository<any>
    ): Promise<any> {
        // 1. Short-circuit defensivo
        if (!data || !path) return data;

        // 2. Extraer una instancia de muestra para inferir el Constructor y sus metadatos
        const sample = Array.isArray(data) ? data[0] : data;
        if (!sample) return data;

        const currentClass = sample.constructor as ClassType<any>;

        // 3. Delegar al resolvedor recursivo que ya tienes preparado
        return await this.resolve(currentClass, data, path, repositoryProvider);
    }


    public validateForeignKeyConstraints<T extends object>(
        entityClass: ClassType<T>,
        entityData: Partial<T>,
        parentCollections: Map<string, any[]>
    ): void {
        // 1. Extraemos la lista de propiedades relacionales registradas en el prototipo
        const relations = this.metadataRegistry.getRelationsList(entityClass);

        for (const relName of relations) {
            const options = this.metadataRegistry.getRelationOptions(entityClass, relName);

            // 2. Solo validamos relaciones directas (Muchos a Uno / Uno a Uno), 
            // ignoramos subcolecciones hijas (1:N) porque la FK vive en la hoja del hijo.
            if (options.isMany === true) continue;

            // 3. CORRECCIÓN: Obtenemos el campo donde reside el ID del padre usando 'localField'
            const fkField = options.localField;
            if (!fkField) continue;

            // Soportamos la extracción si los datos vienen envueltos en un Wrapper (_snapshot / data) o planos
            const targetData = (entityData as any).data ?? (entityData as any)._snapshot ?? entityData;
            const foreignValue = targetData[fkField];

            // 4. Si la FK viene vacía o nula, asumimos que es opcional y saltamos la validación
            if (foreignValue === undefined || foreignValue === null || String(foreignValue).trim() === '') {
                continue;
            }

            const TargetEntityClass = options.targetEntity();

            // 5. CORRECCIÓN: Obtenemos el nombre real de la pestaña usando la metadata del decorador @Table
            // con un fallback a 'options.targetSheet' si existiera de forma explícita.
            const targetSheetName = options.targetSheet || Reflect.getMetadata(SHEETS_TABLE_NAME, TargetEntityClass);
            if (!targetSheetName) {
                continue;
            }

            // 6. Recuperamos los datos precargados de la tabla padre desde el mapa provisto por el Gateway
            const parentData = parentCollections.get(targetSheetName) || [];

            // 7. CORRECCIÓN: Obtenemos la propiedad exacta de la PK en memoria mediante 'getPrimaryKeyField'
            const parentPrimaryKey = this.metadataRegistry.getPrimaryKeyField(TargetEntityClass) || 'id';

            // 8. Verificación síncrona ultrarrápida en memoria O(N)
            const exists = parentData.some(parent => {
                const parentValue = parent[parentPrimaryKey];
                return parentValue !== undefined && parentValue !== null &&
                    String(parentValue).trim() === String(foreignValue).trim();
            });

            // 9. Si el registro no se encuentra, disparamos la excepción de negocio controlada
            if (!exists) {
                throw new BadRequestException(
                    `[RelationEngine] Error de integridad referencial: La propiedad relacional "${String(relName)}" ` +
                    `apunta al valor "${foreignValue}" mediante el campo local "${String(fkField)}", ` +
                    `el cual no existe en la pestaña destino "${targetSheetName}" (Buscado en PK: "${parentPrimaryKey}").`
                );
            }
        }
    }

    /**
     * =========================================================================
     * 2. DOMINIO DE ESCRITURA: INTEGRIDAD AL ELIMINAR (RESTRICT)
     * =========================================================================
     * Evalúa si un registro padre puede ser eliminado sin romper dependencias físicas.
     */
    public validateRestrictConstraint<P extends object, C extends object>(
        parentEntityClass: ClassType<P>,
        parentId: string | number,
        childEntityClass: ClassType<C>,
        childCollection: C[]
    ): void {
        const parentIdStr = String(parentId).trim();
        const relations = this.metadataRegistry.getRelationsList(childEntityClass);

        for (const relName of relations) {
            const options = this.metadataRegistry.getRelationOptions(childEntityClass, relName);
            if (options.targetEntity() !== parentEntityClass) continue;

            const onDeleteStrategy = options.options?.onDelete || options.onDelete || 'RESTRICT';

            if (onDeleteStrategy === 'RESTRICT') {
                const fkField = options.options?.joinColumn || options.joinColumn || 'id';

                const hasDependents = childCollection.some(child =>
                    String((child as any)[fkField]).trim() === parentIdStr
                );

                if (hasDependents) {
                    throw new BadRequestException(
                        `[RelationEngine] Restricción de integridad: No se puede eliminar el registro con ID "${parentId}" de la entidad ${parentEntityClass.name} porque existen registros dependientes en ${childEntityClass.name}.`
                    );
                }
            }
        }
    }

    public applyCascadeDelete<P extends object, C extends object>(
        parentEntityClass: ClassType<P>,
        parentId: string | number,
        childEntityClass: ClassType<C>,
        childCollection: C[]
    ): C[] {
        const parentIdStr = String(parentId).trim();
        const relations = this.metadataRegistry.getRelationsList(childEntityClass);
        const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(childEntityClass);

        if (!deleteControlProp) return childCollection;

        let processedChildren = [...childCollection];

        for (const relName of relations) {
            const options = this.metadataRegistry.getRelationOptions(childEntityClass, relName);
            if (options.targetEntity() !== parentEntityClass) continue;

            const onDeleteStrategy = options.options?.onDelete || options.onDelete;

            if (onDeleteStrategy === 'CASCADE') {
                const fkField = options.options?.joinColumn || options.joinColumn || 'id';

                processedChildren = processedChildren.map(child => {
                    if (String((child as any)[fkField]).trim() === parentIdStr) {
                        return { ...child, [deleteControlProp]: 'ELIMINADO' };
                    }
                    return child;
                });
            }
        }

        return processedChildren;
    }

    /**
 * Implementación de Joins lógicos para el ODM de Google Sheets.
 * @param data Registros de la colección principal (Hoja origen)
 * @param config Configuración del lookup (from, localField, foreignField, as)
 */
    public async applyLookup<T extends object, R extends object>(
        data: T[],
        config: {
            targetRepository: SheetsRepository<R>; // Recibe la instancia del repositorio directamente
            localField: keyof T | string;
            foreignField: keyof R | string;
            as: string;
        }
    ): Promise<T[]> {
        const { targetRepository, localField, foreignField, as } = config;

        if (!data || data.length === 0) return [];

        // 1. Extraer de forma segura los valores de las claves foráneas respetando Wrappers
        const localValues = [
            ...new Set(
                data.map(item => {
                    const raw = (item as any).data ?? (item as any)._snapshot ?? item;
                    return raw[localField];
                })
                    .filter(val => val !== undefined && val !== null && String(val).trim() !== '')
            )
        ];

        // Cortocircuito: si no hay claves foráneas, inicializamos el campo destino vacío de forma segura
        if (localValues.length === 0) {
            return data.map(item => {
                this.hydrateField(item, as, []);
                return item;
            });
        }

        // 2. Consulta masiva optimizada por bloques en una sola petición HTTP/Caché ($in)
        const relatedDocs = await targetRepository.find({
            where: {
                [foreignField]: { $in: localValues }
            } as any
        });

        // 3. Delegar el cruce ultra-eficiente en memoria al motor síncrono lineal
        return this.applyLookupInMemory(data, relatedDocs, {
            localField: localField as string,
            foreignField: foreignField as string,
            as
        });
    }

    public applyLookupInMemory<T extends object>(
        data: T[],
        foreignCollection: any[],
        config: {
            localField: string;
            foreignField: string;
            as: string;
        }
    ): T[] {
        const { localField, foreignField, as } = config;

        if (!data || data.length === 0) return [];

        // 1. ARTIMAÑA DEL ÍNDICE O(M): Indexamos la colección foránea en un solo bucle lineal
        const indexMap = new Map<string, any[]>();

        if (foreignCollection && foreignCollection.length > 0) {
            for (const doc of foreignCollection) {
                const docRaw = doc.data ?? doc._snapshot ?? doc;
                const foreignValue = docRaw[foreignField];

                if (foreignValue === undefined || foreignValue === null) continue;

                const key = String(foreignValue).trim();
                if (!indexMap.has(key)) {
                    indexMap.set(key, []);
                }
                indexMap.get(key)!.push(doc);
            }
        }

        // 2. ENSAMBLAJE FINAL O(N): Cruzamos los datos en tiempo constante O(1) por cada registro
        return data.map(item => {
            const itemRaw = (item as any).data ?? (item as any)._snapshot ?? item;
            const localValue = itemRaw[localField];
            const searchKey = localValue !== undefined && localValue !== null ? String(localValue).trim() : '';

            // Obtención instantánea del Map en vez de recorrer un .filter() anidado pesado
            const matches = searchKey !== '' ? (indexMap.get(searchKey) || []) : [];

            // Inyección controlada sin destruir los prototipos ni los wrappers del documento
            this.hydrateField(item, as, matches);

            return item;
        });
    }

    private hydrateField(target: any, fieldName: string, value: any): void {
        if (target._snapshot) {
            target._snapshot[fieldName] = value;
        }
        if (target.data) {
            target.data[fieldName] = value;
        }
        target[fieldName] = value;
    }

    public applySetNullConstraint<P extends object, C extends object>(
        parentEntityClass: ClassType<P>,
        parentId: string | number,
        childEntityClass: ClassType<C>,
        childCollection: C[]
    ): C[] {
        const parentIdStr = String(parentId).trim();
        const relations = this.metadataRegistry.getRelationsList(childEntityClass);

        let processedChildren = [...childCollection];

        for (const relName of relations) {
            const options = this.metadataRegistry.getRelationOptions(childEntityClass, relName);
            if (options.targetEntity() !== parentEntityClass) continue;

            const onDeleteStrategy = options.options?.onDelete || options.onDelete;

            if (onDeleteStrategy === 'SET_NULL') {
                const fkField = options.options?.joinColumn || options.joinColumn || 'id';

                processedChildren = processedChildren.map(child => {
                    if (String((child as any)[fkField]).trim() === parentIdStr) {
                        return { ...child, [fkField]: null };
                    }
                    return child;
                });
            }
        }

        return processedChildren;
    }

    public applyCascadeUpdate<C extends object>(
        childCollection: C[],
        fkField: string,
        oldId: string | number,
        newId: string | number
    ): C[] {
        const oldIdStr = String(oldId).trim();

        return childCollection.map(child => {
            if (String((child as any)[fkField]).trim() === oldIdStr) {
                return { ...child, [fkField]: newId };
            }
            return child;
        });
    }

    public async validateRelations<T extends object>(
        instance: T,
        repositoryProvider: (entityClass: ClassType<any>) => SheetsRepository<any> // 👈 Corrección de la firma
    ): Promise<boolean> {
        if (!instance) return true;

        const entityClass = instance.constructor as ClassType<T>;
        const relations = this.metadataRegistry.getRelationsList(entityClass);

        for (const relName of relations) {
            const options = this.metadataRegistry.getRelationOptions(entityClass, relName);

            if (!options || options.isMany) continue;

            const rawData = this.extractRawData(instance);
            const localField = options.localField || 'id';
            const localValue = rawData[localField];

            if (localValue !== undefined && localValue !== null && String(localValue).trim() !== '') {
                const TargetEntityClass = options.targetEntity();

                // 🚀 Ahora sí es una función ejecutable y tipada limpiamente
                const targetRepository = repositoryProvider(TargetEntityClass);
                if (!targetRepository) {
                    throw new InternalServerErrorException(
                        `[RelationEngine] No se pudo obtener el repositorio para la entidad "${TargetEntityClass.name}" a través del proveedor.`
                    );
                }

                const foreignPrimaryKey = this.metadataRegistry.getPrimaryKeyField(TargetEntityClass) || 'id';

                const exists = await targetRepository.findOne({
                    [foreignPrimaryKey]: localValue
                } as FilterQuery<any>);

                if (!exists) {
                    throw new Error(
                        `[Integrity Error] Falló la restricción de clave foránea en la propiedad "${String(relName)}". ` +
                        `El valor "${localValue}" no existe en la hoja destino "${TargetEntityClass.name}".`
                    );
                }
            }
        }

        return true;
    }

    public async populateDeep<T extends object>(
        data: T | T[],
        path: string,
        repositoryProvider: (entityClass: ClassType<any>) => SheetsRepository<any> // 👈 CORRECCIÓN AQUÍ
    ): Promise<any> {
        if (!data || !path) return data;

        // Detectamos la clase base inspeccionando la instancia (o el primer elemento si es un array)
        const sample = Array.isArray(data) ? data[0] : data;
        if (!sample) return data;

        const baseClass = sample.constructor as ClassType<any>;

        // Ahora el callback fluye perfectamente hacia el resolvedor recursivo
        return this.resolve(baseClass, data, path, repositoryProvider);
    }
    /**
     * Retorna el mapa completo de relaciones configuradas para esta entidad.
     */
    public getRelationMetadata<T extends object>(entityClass: ClassType<T>): Record<string, RelationOptions> {
        const target = entityClass.prototype;
        // Utilizamos Reflect directamente sobre el prototype de la clase pasada por parámetro
        const relationsList: string[] = Reflect.getMetadata(SHEETS_RELATIONS_LIST, target) || [];
        const metadataMap: Record<string, RelationOptions> = {};

        for (const key of relationsList) {
            const options = Reflect.getMetadata(SHEETS_ALL_RELATIONS, target, key);
            if (options) {
                metadataMap[key] = options;
            }
        }
        return metadataMap;
    }

    private async resolve(
        currentClass: ClassType<any>,
        data: any | any[],
        path: string,
        repositoryProvider: (entityClass: ClassType<any>) => SheetsRepository<any> // 👈 CORRECCIÓN AQUÍ
    ): Promise<any> {
        if (!data) return data;

        // Si es un lote/array, procesamos concurrentemente las bifurcaciones recursivas
        if (Array.isArray(data)) {
            return await Promise.all(data.map(item => this.resolve(currentClass, item, path, repositoryProvider)));
        }

        const parts = path.split('.');
        const currentField = parts[0];
        const remainingPath = parts.slice(1).join('.');

        // 1. Extracción de metadatos tipados usando el registro centralizado
        const options = this.metadataRegistry.getRelationOptions(currentClass, currentField);

        if (!options) {
            this.logger.warn(`No se encontró configuración de relación para el campo "${currentField}" en la clase ${currentClass.name}`);
            return data;
        }

        const TargetEntityClass = options.targetEntity();
        const rawData = this.extractRawData(data);

        const localField = options.localField || 'id';
        const localValue = rawData[localField];

        // 2. Obtención segura del repositorio remoto ejecutando la función proveedora
        const targetRepository = repositoryProvider(TargetEntityClass); // 👈 Ahora compila perfectamente
        if (!targetRepository) {
            this.logger.error(`❌ Repositorio de relación para "${TargetEntityClass.name}" no fue provisto por el contexto.`);
            return data;
        }

        let relatedResult: any;

        // 3. Consultas optimizadas según cardinalidad
        if (options.isMany) {
            this.logger.debug(`[RelationEngine] Buscando hijos (1:N) en "${TargetEntityClass.name}" para el campo "${currentField}"`);

            const joinColumn = options.joinColumn || 'id';
            relatedResult = await targetRepository.find({
                [joinColumn]: localValue
            } as FilterQuery<any>);
        } else {
            this.logger.debug(`[RelationEngine] Buscando hijo directo (1:1) en "${TargetEntityClass.name}" para el campo "${currentField}"`);

            const joinColumn = options.joinColumn || 'id';
            relatedResult = await targetRepository.findOne({
                [joinColumn]: localValue
            } as FilterQuery<any>);
        }

        // 4. Recursividad profunda sobre los resultados obtenidos
        if (remainingPath && relatedResult) {
            relatedResult = await this.resolve(TargetEntityClass, relatedResult, remainingPath, repositoryProvider);
        }

        // 5. Hidratación simétrica y preservación del estado mutativo en el wrapper del ODM
        this.hydrateField(data, currentField, relatedResult);

        return data;
    }

    private extractRawData(item: any): any {
        return item?.data ?? item?._snapshot ?? item;
    }

    /**
     * Helper privado para inyectar relaciones en todas las capas del documento a la vez
     */

}