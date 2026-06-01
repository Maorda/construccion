import { ModuleRef } from "@nestjs/core";
import { SheetDataGateway } from "@sheetOdm/gateway/sheetDataGateway";
import { QueryEngine } from "@sheetOdm/pipelines/query.engine";
import { DataMapper } from "@sheetOdm/services/data-mapper.service";
import { MetadataRegistry } from "@sheetOdm/services/metadata-registry.service";
import { RelationManager } from "@sheetOdm/services/relation-manager.service";
import { ClassType } from "@sheetOdm/types/query.types";
import { SheetsRepository } from "./sheets.repository";
import { SheetDocumentHydrator } from "@sheetOdm/core/base/SheetDocumentHydrator";
import { UnitOfWork } from "@sheetOdm/services/UnitOfWork";

export class SheetsRepositoryBuilder {
    // Método estático puro. Entran dependencias, sale un Repositorio. Cero estado global.
    static build<T extends object>(
        entityClass: ClassType<T>,
        metadataRegistry: MetadataRegistry,
        queryEngine: QueryEngine,
        gateway: SheetDataGateway,
        relationManager: RelationManager,
        dataMapper: DataMapper,
        moduleRef: ModuleRef,
        hydrator: SheetDocumentHydrator,
        unitOfWork: UnitOfWork
    ): SheetsRepository<T> {
        return new SheetsRepository<T>(
            metadataRegistry,
            queryEngine,
            gateway,
            entityClass,
            relationManager,
            dataMapper,
            moduleRef,
            hydrator,
            unitOfWork
        );
    }
}