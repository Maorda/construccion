import { Injectable } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { ModuleRef } from '@nestjs/core';
import { SheetsRepository } from '@sheetOdm/repository/sheets.repository';
import { getRepositoryToken } from '@sheetOdm/utils/helper';
import { ClassType, PopulateOptions } from '@sheetOdm/types/query.types';

@Injectable()
export class RelationManager {
    constructor(
        private readonly registry: MetadataRegistry,
        private readonly moduleRef: ModuleRef
    ) { }

    /**
     * Resuelve y "popula" de manera óptima las relaciones detectadas en los metadatos.
     */
    async populate<T extends object>(
        entities: T[],
        entityClass: ClassType<T>,
        populateOptions: PopulateOptions<T>[], // Cambiamos de opciones simples a array de configuración
        options?: { includeInactive?: boolean }
    ): Promise<T[]> {
        if (!entities || entities.length === 0 || populateOptions.length === 0) return entities;

        const localPkField = this.registry.getPrimaryKeyField(entityClass);

        for (const popConfig of populateOptions) {
            const relKey = popConfig.path as string;
            const relOptions = this.registry.getRelationOptions(entityClass, relKey);
            if (!relOptions) continue;

            const targetEntityClass = relOptions.targetEntity();
            const childRepo = this.getRepositoryForEntity(targetEntityClass);
            const targetPkField = this.registry.getPrimaryKeyField(targetEntityClass);

            if (relOptions.isMany) {
                // Caso A: @SubCollection
                const joinColumn = relOptions.options?.joinColumn || `${entityClass.name.toLowerCase()}Id`;
                const parentIds = entities.map(e => (e as any)[localPkField]).filter(Boolean);

                // Fusión del filtro del usuario (match) con el filtro de relación
                const query = { ...popConfig.match, [joinColumn]: { $in: parentIds } };

                const relatedData = await childRepo.find(query, { includeInactive: options?.includeInactive });

                for (const parent of entities) {
                    const parentId = (parent as any)[localPkField];
                    (parent as any)[relKey] = relatedData.filter(c => (c as any)[joinColumn] === parentId);
                }
            } else {
                // Caso B: @Reference
                const joinColumn = relOptions.joinColumn;
                const targetIdsNeeded = entities.map(e => (e as any)[joinColumn]).filter(Boolean);

                // CORRECCIÓN: Usamos targetIdsNeeded, no parentIds
                const query = { ...popConfig.match, [targetPkField]: { $in: targetIdsNeeded } };

                const relatedData = await childRepo.find(query, { includeInactive: options?.includeInactive });

                for (const current of entities) {
                    const foreignKeyValue = (current as any)[joinColumn];
                    (current as any)[relKey] = relatedData.find(p => (p as any)[targetPkField] === foreignKeyValue) || null;
                }
            }
        }
        return entities;
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

            // Extraemos la FK según corresponda al tipo de relación
            const fkName = relOptions.isMany
                ? (relOptions.options?.joinColumn || `${parentClass.name.toLowerCase()}Id`)
                : relOptions.joinColumn;

            // Normalizamos la estructura para procesar iterativamente (un solo objeto o array)
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
                // Persistencia en Google Sheets delegada a la unidad operativa del repositorio
                await childRepo.save(doc);
            }
        }
    }

    public getRepositoryForEntity<R extends object = any>(entityClass: ClassType<R>): SheetsRepository<R> {
        const repoToken = getRepositoryToken(entityClass);
        const repo = this.moduleRef.get<SheetsRepository<R>>(repoToken, { strict: false });

        if (!repo) {
            throw new Error(`[ODM Relation Error] No se pudo resolver el repositorio para la entidad [${entityClass.name}]. Asegúrate de declararla en el forFeature().`);
        }

        return repo;
    }
    async resolveRepository<T extends object>(entityClass: ClassType<T>, moduleRef: ModuleRef): Promise<SheetsRepository<T>> {
        const repoToken = getRepositoryToken(entityClass);
        return moduleRef.get<SheetsRepository<T>>(repoToken, { strict: false });
    }
}