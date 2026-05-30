import { Inject, Injectable } from '@nestjs/common';
import { GoogleAutenticarService } from '@sheetOdm/services/auth.google.service';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { QueryEngine } from '@sheetOdm/pipelines/query.engine';
import type { DatabaseModuleOptions } from '@sheetOdm/interfaces/database.options.interface';
import { SheetsRepository, GLOBAL_REPO_REGISTRY } from './sheets.repository';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { RelationManager } from '@sheetOdm/services/relation-manager.service';
import { DataMapper } from '@sheetOdm/services/data-mapper.service';
import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator';
import { ProjectionService } from '@sheetOdm/engines/projection.service';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class SheetsRepositoryFactory {
    constructor(
        private readonly googleSheets: GoogleAutenticarService,
        private readonly metadataRegistry: MetadataRegistry,
        private readonly queryEngine: QueryEngine,
        @Inject('DATABASE_OPTIONS') private readonly optionsDatabase: DatabaseModuleOptions,
        private readonly gateway: SheetDataGateway,
        private readonly relationManager: RelationManager,
        private readonly dataMapper: DataMapper,
        private readonly hydrator: SheetDocumentHydrator,
        private readonly projectionService: ProjectionService,
        private moduleRef: ModuleRef,
    ) { }

    /**
     * Fabrica dinámicamente un SheetsRepository listo para operar una Entidad específica.
     */
    create<T extends object>(entityClass: new () => T): SheetsRepository<T> {
        const repo = new SheetsRepository<T>(
            this.googleSheets,
            this.metadataRegistry,
            this.queryEngine,
            this.optionsDatabase,
            this.gateway,
            entityClass,
            this.relationManager,
            this.dataMapper,
            this.moduleRef

        );

        // repo.entityClass = entityClass;

        // Registrar en el mapa global para que populate() pueda consultarlo sin dependencias circulares
        GLOBAL_REPO_REGISTRY.set(entityClass, repo);

        return repo;
    }
}
