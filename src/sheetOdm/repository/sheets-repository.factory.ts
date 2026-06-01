import { Injectable } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { QueryEngine } from '@sheetOdm/pipelines/query.engine';
import { SheetsRepository } from './sheets.repository';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { RelationManager } from '@sheetOdm/services/relation-manager.service';
import { DataMapper } from '@sheetOdm/services/data-mapper.service';
import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator';
import { ModuleRef } from '@nestjs/core';
import { ClassType } from '@sheetOdm/types/query.types';

@Injectable()
export class SheetsRepositoryFactory<T extends object> {
    constructor(

        private readonly metadataRegistry: MetadataRegistry,
        private readonly queryEngine: QueryEngine,
        private readonly gateway: SheetDataGateway,
        private readonly relationManager: RelationManager,
        private readonly dataMapper: DataMapper,
        private readonly hydrator: SheetDocumentHydrator,

        private moduleRef: ModuleRef,
    ) { }

    /**
     * Fabrica dinámicamente un SheetsRepository listo para operar una Entidad específica.
     */create(entityClass: ClassType<T>): SheetsRepository<T> {
        // Retornamos la instancia pasando el orden exacto del constructor purificado
        return new SheetsRepository<T>(
            this.metadataRegistry,
            this.queryEngine,
            this.gateway,
            entityClass,
            this.relationManager,
            this.dataMapper,
            this.moduleRef,
            this.hydrator,
        );
    }
}
