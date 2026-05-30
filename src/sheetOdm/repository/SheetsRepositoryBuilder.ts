import { ModuleRef } from "@nestjs/core";
import { SheetDataGateway } from "@sheetOdm/gateway/sheetDataGateway";
import { DatabaseModuleOptions } from "@sheetOdm/interfaces/database.options.interface";
import { QueryEngine } from "@sheetOdm/pipelines/query.engine";
import { GoogleAutenticarService } from "@sheetOdm/services/auth.google.service";
import { DataMapper } from "@sheetOdm/services/data-mapper.service";
import { MetadataRegistry } from "@sheetOdm/services/metadata-registry.service";
import { RelationManager } from "@sheetOdm/services/relation-manager.service";
import { ClassType } from "@sheetOdm/types/query.types";
import { SheetsRepository } from "./sheets.repository";

export class SheetsRepositoryBuilder {
    // Método estático puro. Entran dependencias, sale un Repositorio. Cero estado global.
    static build<T extends object>(
        entityClass: ClassType<T>,
        googleSheets: GoogleAutenticarService,
        metadataRegistry: MetadataRegistry,
        queryEngine: QueryEngine,
        optionsDatabase: DatabaseModuleOptions,
        gateway: SheetDataGateway,
        relationManager: RelationManager,
        dataMapper: DataMapper,
        moduleRef: ModuleRef
    ): SheetsRepository<T> {
        return new SheetsRepository<T>(
            googleSheets, metadataRegistry, queryEngine, optionsDatabase,
            gateway, entityClass, relationManager, dataMapper, moduleRef
        );
    }
}