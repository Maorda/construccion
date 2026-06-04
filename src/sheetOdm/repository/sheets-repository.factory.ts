import { Injectable, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { SheetsRepository } from './sheets.repository';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { RelationManager } from '@sheetOdm/services/relation-manager.service';
import { DataMapper } from '@sheetOdm/services/data-mapper.service';
import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator';
import { UnitOfWork } from '@sheetOdm/services/UnitOfWork';
import { QueryEngine } from '@sheetOdm/engines/query.engine';
import { ClassType } from '@sheetOdm/types/query.types';

@Injectable()
export class SheetsRepositoryFactory {
    // Constructor limpio: solo necesitamos el contenedor de NestJS
    constructor(private readonly moduleRef: ModuleRef) { }

    /**
     * Fabrica dinámicamente un SheetsRepository.
     * Si necesitas agregar más dependencias al Repository en el futuro,
     * no tendrás que modificar esta clase.
     */
    create<T extends object>(entityClass: ClassType<T>): SheetsRepository<T> {
        return new SheetsRepository(
            this.moduleRef.get(MetadataRegistry, { strict: false }),
            this.moduleRef.get(QueryEngine, { strict: false }),
            this.moduleRef.get(SheetDataGateway, { strict: false }),
            entityClass,
            this.moduleRef.get(RelationManager, { strict: false }),
            this.moduleRef.get(DataMapper, { strict: false }),
            this.moduleRef,
            this.moduleRef.get(SheetDocumentHydrator, { strict: false }),
            this.moduleRef.get(UnitOfWork, { strict: false }),
        );
    }
}