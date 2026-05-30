import { Injectable } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { DataMapper } from './data-mapper.service';
import { ModuleRef } from '@nestjs/core';
import { SheetsRepository } from '@sheetOdm/repository/sheets.repository';
import { getRepositoryToken } from '@sheetOdm/utils/helper';
import { ClassType } from '@sheetOdm/types/query.types';

@Injectable()
export class RelationManager {
    constructor(
        private readonly registry: MetadataRegistry,
        private readonly gateway: SheetDataGateway,
        private readonly dataMapper: DataMapper,
        private readonly moduleRef: ModuleRef
    ) { }

    /**
     * Resuelve y "popula" las relaciones de una entidad (o lista de entidades)
     */
    async populate<T extends object>(
        entities: T[],
        entityClass: ClassType<T>,
        options?: { includeInactive?: boolean }
    ): Promise<T[]> {
        if (!entities || entities.length === 0) return entities;

        const relationKeys = this.registry.getRelationsList(entityClass);
        const localPkField = this.registry.getPrimaryKeyField(entityClass);

        for (const relKey of relationKeys) {
            const relOptions = this.registry.getRelationOptions(entityClass, relKey);
            const targetEntityClass = relOptions.targetEntity();

            // 1. Resolver el repositorio del hijo usando el token unificado oficial
            const childRepo = this.getRepositoryForEntity(targetEntityClass);

            // 2. Traer los hijos a través de su propio repositorio (Aplica Soft-Delete y Hydration automáticamente)
            const children = await childRepo.find({}, { includeInactive: options?.includeInactive });

            // 3. Determinar la FK de la relación basada en metadata o convención dinámica limpia
            const joinColumn = relOptions.options?.joinColumn || `${entityClass.name.toLowerCase()}Id`;

            // 4. Mapear de forma segura usando las claves dinámicas del Registry
            for (const parent of entities) {
                const parentId = (parent as any)[localPkField];

                // Asignamos la colección filtrada de SheetDocuments vivos
                (parent as any)[relKey] = children.filter(c => (c as any)[joinColumn] === parentId);
            }
        }
        return entities;
    }

    /**
     * Persiste en cascada los registros hijos vinculados a un padre.
     */
    async saveChildren(parent: any, relations: Record<string, any[]>, parentClass: ClassType) {
        const localPkField = this.registry.getPrimaryKeyField(parentClass);
        const parentId = parent[localPkField];

        for (const [relKey, childrenData] of Object.entries(relations)) {
            const relOptions = this.registry.getRelationOptions(parentClass, relKey);
            if (!relOptions) continue;

            const targetClass = relOptions.targetEntity();
            const childRepo = this.getRepositoryForEntity(targetClass);

            const fkName = relOptions.options?.joinColumn || `${parentClass.name.toLowerCase()}Id`;

            for (const childData of childrenData) {
                // Inyectamos de manera segura el ID del padre en la FK del hijo
                childData[fkName] = parentId;

                // 1. Pasamos por la Factory para armar el documento e inyectar UUIDs si aplica
                const childDoc = childRepo.create(childData);

                // 2. 🚀 GUARDADO EFECTIVO: Forzamos la persistencia real en Google Sheets
                await childRepo.save(childDoc);
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
}