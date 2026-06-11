import { Injectable, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service.js';
import { SheetsRepository } from './sheets.repository.js';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway.js';
import { RelationManager } from '@sheetOdm/services/relation-manager.service.js';
import { DataMapper } from '@sheetOdm/services/data-mapper.service.js';
import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator.js';
import { UnitOfWork } from '@sheetOdm/services/UnitOfWork.js';
import { QueryEngine } from '@sheetOdm/engines/query.engine.js';
import { ClassType } from '@sheetOdm/types/query.types.js';
import { ValidationEngine } from '@sheetOdm/engines/ValidationEngine.js';
import { SheetDataTransformer } from '@sheetOdm/core/base/sheetDataTransformer.js';
import { GasService } from '@sheetOdm/core/base/services/gas.service.js';
import { WalManagerService } from '@sheetOdm/services/wal-manager.service.js';
import { MutationEngine } from '@sheetOdm/engines/mutationEngine.js';

@Injectable()
export class SheetsRepositoryFactory {
    // Constructor limpio: solo necesitamos el contenedor de NestJS
    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly metadata: MetadataRegistry,
        private readonly queryEngine: QueryEngine,
        private readonly mutationEngine: MutationEngine,
        private readonly validationEngine: ValidationEngine,
        private readonly transformer: SheetDataTransformer,
        private readonly gasService: GasService,
        private readonly gateway: SheetDataGateway,
        private readonly relationManager: RelationManager,
        private readonly walManager: WalManagerService
    ) { }

    /**
     * Fabrica dinámicamente un SheetsRepository.
     * Si necesitas agregar más dependencias al Repository en el futuro,
     * no tendrás que modificar esta clase.
     */
    /**
      * Factory asíncrona: resuelve solo lo necesario en tiempo de ejecución
      */
    async create<T extends object>(entityClass: ClassType<T>): Promise<SheetsRepository<T>> {
        // Resolvemos dependencias con scope REQUEST/TRANSIENT
        const [hydrator, uow, mapper] = await Promise.all([
            this.moduleRef.resolve(SheetDocumentHydrator),
            this.moduleRef.resolve(UnitOfWork),
            this.moduleRef.resolve(DataMapper)
        ]);

        return new SheetsRepository(
            this.metadata,
            this.queryEngine,
            this.mutationEngine,
            this.validationEngine,
            this.transformer,
            this.gasService,
            this.gateway,
            entityClass,
            this.relationManager,
            this.moduleRef,
            hydrator,
            uow,
            mapper,
            this.walManager
        );
    }
}