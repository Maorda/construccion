import { Injectable } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { DataMapper } from './data-mapper.service';
import { SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import { ModuleRef } from '@nestjs/core';
import { SheetsRepository } from '@sheetOdm/repository/sheets.repository';

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
    async populate<T extends object>(entities: T[], entityClass: Function): Promise<T[]> {
        const relationKeys = this.registry.getRelationsList(entityClass);

        for (const relKey of relationKeys) {
            const relOptions = this.registry.getRelationOptions(entityClass, relKey);
            const targetEntityClass = relOptions.targetEntity();
            const sheetName = Reflect.getMetadata(SHEETS_TABLE_NAME, targetEntityClass);

            // 1. Lectura pura (gateway)
            const rawRows = await this.gateway.getRange(`${sheetName}!A:Z`);

            // 2. Transformación (dataMapper) - ¡Aquí está la magia!
            // Ignoramos la cabecera (slice 1) y mapeamos
            const children = rawRows.slice(1).map(row => this.dataMapper.toEntity(row, targetEntityClass));

            // 3. Vincular (lógica de negocio)
            const joinColumn = relOptions.options?.joinColumn || `id${entityClass.name.replace('Entity', '')}`;

            for (const parent of entities) {
                const parentId = (parent as any).id;
                (parent as any)[relKey] = children.filter(c => (c as any)[joinColumn] === parentId);
            }
        }
        return entities;
    }

    async saveChildren(parent: any, relations: Record<string, any[]>, parentClass: Function) {
        for (const [relKey, children] of Object.entries(relations)) {
            const relOptions = this.registry.getRelationOptions(parentClass, relKey);
            const targetClass = relOptions.targetEntity();

            // Obtenemos el repositorio dinámicamente. 
            // El token debe seguir una convención: 'SheetsRepository_' + NombreClase
            const repoToken = `SheetsRepository_${targetClass.name}`;
            const repo = this.moduleRef.get<SheetsRepository<any>>(repoToken, { strict: false });

            const fkName = relOptions.options?.joinColumn || `id${parentClass.name.replace('Entity', '')}`;

            for (const child of children) {
                child[fkName] = parent.id;
                await repo.create1(child); // Invocamos el create existente
            }
        }
    }

    async getRepositoryForEntity(entityClass: Function) {
        // Usamos la misma convención que definiste en forFeature
        const repoToken = `${entityClass.name}Repository`;
        return this.moduleRef.get(repoToken, { strict: false });
    }
}