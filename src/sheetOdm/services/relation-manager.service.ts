import { Injectable } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { ModuleRef } from '@nestjs/core';
import { SheetsRepository } from '@sheetOdm/repository/sheets.repository';
import { getRepositoryToken } from '@sheetOdm/utils/helper';
import { ClassType, PopulateOptions, QueryOptions } from '@sheetOdm/types/query.types';
import { SheetDocument } from '@sheetOdm/wrapper/sheetDocument';

@Injectable()
export class RelationManager {
    constructor(
        private readonly registry: MetadataRegistry,
        private readonly moduleRef: ModuleRef
    ) { }

    /**
     * Resuelve y "popula" de manera óptima las relaciones detectadas en los metadatos.
     * Soporta filtros, límites, ordenamiento y proyecciones dinámicas para sub-entidades.
     */
    async populate<T extends object>(
        documents: SheetDocument<T>[],
        entityClass: ClassType<T>,
        populateOptions: PopulateOptions<T, any>[],
        options?: QueryOptions<T>
    ): Promise<SheetDocument<T>[]> {
        if (!documents || documents.length === 0 || !populateOptions || populateOptions.length === 0) {
            return documents;
        }

        const localPkField = this.registry.getPrimaryKeyField(entityClass);

        for (const popConfig of populateOptions) {
            const relKey = popConfig.path as string;
            const relOptions = this.registry.getRelationOptions(entityClass, relKey);
            if (!relOptions) continue;

            const targetEntityClass = relOptions.targetEntity();
            const childRepo = this.getRepositoryForEntity(targetEntityClass);
            const targetPkField = this.registry.getPrimaryKeyField(targetEntityClass);

            // Construimos las opciones dinámicas de consulta para el hijo basándonos en PopulateOptions
            const childQueryOptions: QueryOptions<any> = {
                includeInactive: options?.includeInactive,
                forceRefresh: options?.forceRefresh,
                projection: popConfig.select ? this.buildProjection(popConfig.select) : undefined,
                limit: popConfig.limit,
                sort: popConfig.sort ? this.normalizeSort(popConfig.sort) : undefined
            };

            if (relOptions.isMany) {
                // ==========================================
                // CASO A: @SubCollection (OneToMany / ManyToMany)
                // ==========================================
                const joinColumn = relOptions.options?.joinColumn || `${entityClass.name.toLowerCase()}Id`;
                const parentIds = documents.map(doc => (doc as any)[localPkField]).filter(Boolean);

                if (parentIds.length === 0) continue;

                const query = { ...popConfig.match, [joinColumn]: { $in: parentIds } };
                const relatedData = await childRepo.find(query, childQueryOptions);

                // Agrupamos en un Mapa indexado por la FK para velocidad O(1) en la asignación
                const relatedMap = new Map<any, any[]>();
                for (const childDoc of relatedData) {
                    const fkValue = (childDoc as any)[joinColumn];
                    if (!relatedMap.has(fkValue)) {
                        relatedMap.set(fkValue, []);
                    }
                    relatedMap.get(fkValue)!.push(childDoc);
                }

                // Asignamos los arreglos a cada documento padre
                for (const parentDoc of documents) {
                    const parentId = (parentDoc as any)[localPkField];
                    (parentDoc as any)[relKey] = relatedMap.get(parentId) || [];
                }

            } else {
                // ==========================================
                // CASO B: @Reference (ManyToOne / OneToOne)
                // ==========================================
                const joinColumn = relOptions.joinColumn;
                const targetIdsNeeded = documents.map(doc => (doc as any)[joinColumn]).filter(Boolean);

                if (targetIdsNeeded.length === 0) continue;

                const query = { ...popConfig.match, [targetPkField]: { $in: targetIdsNeeded } };
                const relatedData = await childRepo.find(query, childQueryOptions);

                // Mapeamos los objetos indexados por su PK primaria destino
                const relatedMap = new Map<any, any>();
                for (const childDoc of relatedData) {
                    const pkValue = (childDoc as any)[targetPkField];
                    relatedMap.set(pkValue, childDoc);
                }

                // Asignamos la relación singular a cada documento
                for (const currentDoc of documents) {
                    const foreignKeyValue = (currentDoc as any)[joinColumn];
                    (currentDoc as any)[relKey] = relatedMap.get(foreignKeyValue) || null;
                }
            }
        }
        return documents;
    }

    /**
     * Guarda en cascada relaciones pendientes inyectando la clave foránea correspondiente.
     */
    async saveChildren(parent: any, relations: Record<string, any>, parentClass: ClassType) {
        const localPkField = this.registry.getPrimaryKeyField(parentClass);
        const parentId = parent[localPkField];

        for (const [relKey, relationData] of Object.entries(relations)) {
            if (!relationData) continue;

            const relOptions = this.registry.getRelationOptions(parentClass, relKey);
            if (!relOptions) continue;

            const targetClass = relOptions.targetEntity();
            const childRepo = this.getRepositoryForEntity(targetClass);

            const fkName = relOptions.isMany
                ? (relOptions.options?.joinColumn || `${parentClass.name.toLowerCase()}Id`)
                : relOptions.joinColumn;

            const dataset = Array.isArray(relationData) ? relationData : [relationData];

            for (const item of dataset) {
                let doc;
                if (typeof item.save === 'function') {
                    doc = item;
                    (doc as any)[fkName] = parentId;
                } else {
                    item[fkName] = parentId;
                    doc = childRepo.create(item);
                }
                await childRepo.save(doc);
            }
        }
    }

    /**
     * Obtiene de forma dinámica el repositorio asociado a una entidad.
     */
    public getRepositoryForEntity<R extends object = any>(entityClass: ClassType<R>): SheetsRepository<R> {
        const repoToken = getRepositoryToken(entityClass);
        const repo = this.moduleRef.get<SheetsRepository<R>>(repoToken, { strict: false });

        if (!repo) {
            throw new Error(`[ODM Relation Error] No se pudo resolver el repositorio para la entidad [${entityClass.name}]. Asegúrate de declararla en el forFeature().`);
        }

        return repo;
    }

    /**
     * Resuelve de manera asíncrona un repositorio usando una referencia de módulo específica.
     */
    async resolveRepository<T extends object>(entityClass: ClassType<T>, moduleRef: ModuleRef): Promise<SheetsRepository<T>> {
        const repoToken = getRepositoryToken(entityClass);
        return moduleRef.get<SheetsRepository<T>>(repoToken, { strict: false });
    }

    // ==========================================
    // MÉTODOS AUXILIARES DE SOPORTE
    // ==========================================

    /** Convierte una lista de campos ['id', 'name'] a un objeto de proyección { id: true, name: true } */
    private buildProjection(selectFields: Array<any>): Record<string, boolean> {
        const projection: Record<string, boolean> = {};
        for (const field of selectFields) {
            if (typeof field === 'string') {
                projection[field] = true;
            }
        }
        return projection;
    }

    /** Normaliza el formato de ordenamiento del populate al formato requerido por QueryOptions */
    private normalizeSort(sortOption: Record<string, any>): { field: string; order: 'ASC' | 'DESC' } | undefined {
        const keys = Object.keys(sortOption);
        if (keys.length === 0) return undefined;

        const field = keys[0];
        const val = sortOption[field];
        const order = (val === 1 || val === 'ASC') ? 'ASC' : 'DESC';

        return { field, order };
    }
}