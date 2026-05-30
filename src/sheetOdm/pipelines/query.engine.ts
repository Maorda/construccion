import { Injectable } from '@nestjs/common';
import { FilterQuery, IQueryEngine, QueryOptions } from '@sheetOdm/types/query.types';
import { MatchStage, SortStage } from '../engines/query/match_sort_pagination';
import { ProjectStage } from '../engines/query/projection';
import { IQueryStage } from '../engines/query/IPipelineStage';
import { AddFieldsStage } from './stages/add-fields.stage';
import { GroupStage } from './stages/group.stage';
import { LimitStage } from './stages/limit.stage';
import { LookupStage } from './stages/lookup.stage';
import { SkipStage } from './stages/skip.stage';
import { UnwindStage } from './stages/unwind.stage';
import { ExpressionEngine } from '@sheetOdm/engines/expression.engine';
import { ProjectionService } from '@sheetOdm/engines/projection.service';
import { SheetCollection } from '@sheetOdm/wrapper/sheetCollection';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { ROW_INDEX_SYMBOL } from '@sheetOdm/constants/metadata.constants';
import { ModuleRef } from '@nestjs/core';
import { getRepositoryToken } from '@sheetOdm/utils/helper';
import { SheetDocument } from '@sheetOdm/wrapper/sheetdocument';
import { SheetsRepository } from '@sheetOdm/repository/sheets.repository';


@Injectable()
export class QueryEngine<T extends object> implements IQueryEngine {
    private stageRegistry: Map<string, IQueryStage>;
    // 1. Caché de documentos (Identity Map)
    private identityMap = new Map<string, SheetCollection<any>>();
    // 2. Cola de mutaciones (Unit of Work)
    private readonly unitOfWork = new Set<SheetDocument<T>>();

    constructor(
        private readonly match: MatchStage,
        private readonly project: ProjectStage,
        private readonly lookup: LookupStage,
        private readonly sort: SortStage,
        private readonly group: GroupStage,
        private readonly unwind: UnwindStage,
        private readonly addFields: AddFieldsStage,
        private readonly limit: LimitStage,
        private readonly skip: SkipStage,

        // Agrega estos dos
        private readonly expressionEngine: ExpressionEngine,
        private readonly projectionService: ProjectionService,
        private readonly gateway: SheetDataGateway,
        private readonly metadata: MetadataRegistry,
        private readonly moduleRef: ModuleRef
    ) {
        // Registro centralizado
        this.stageRegistry = new Map<string, IQueryStage>([
            ['$match', this.match],
            ['$project', this.project],
            ['$lookup', this.lookup],
            ['$sort', this.sort],
            ['$group', this.group],
            ['$unwind', this.unwind],
            ['$addFields', this.addFields],
            ['$limit', this.limit],
            ['$skip', this.skip]
        ]);
    }

    /**
     * Ejecuta una consulta de filtrado, ordenamiento y paginación sobre una colección en memoria.
     */
    public async execute<T extends object>(
        data: T[],
        filter: FilterQuery<T>,
        options?: QueryOptions
    ): Promise<any[]> {

        const pipeline: any[] = [];

        // 1. Convertir 'filter' a $match
        if (filter && Object.keys(filter).length > 0) {
            pipeline.push({ $match: filter });
        }

        // 2. Convertir 'sort' a $sort
        if (options?.sort) {
            // Asumiendo que tu SortStage acepta { field, order } o el formato de MongoDB
            pipeline.push({ $sort: { [options.sort.field]: options.sort.order === 'ASC' ? 1 : -1 } });
        }

        // 3. Paginación: Skip
        const skip = options?.skip ?? options?.offset ?? 0;
        if (skip > 0) {
            pipeline.push({ $skip: skip });
        }

        // 4. Paginación: Limit
        if (options?.limit !== undefined && options.limit !== null) {
            pipeline.push({ $limit: options.limit });
        }

        // 5. Proyección
        if (options?.projection) {
            pipeline.push({ $project: options.projection });
        }

        // ¡La magia! Reutilizamos toda la lógica ya probada en aggregate
        return await this.aggregate(data, pipeline);
    }

    /**
     * Ejecuta un pipeline de agregación.
     */
    public async aggregate(data: any[], pipeline: any[]): Promise<any[]> {
        let result = [...data];

        for (const stage of pipeline) {
            const operator = Object.keys(stage)[0];
            const config = stage[operator];
            const handler = this.stageRegistry.get(operator);

            if (!handler) {
                throw new Error(`Operador no soportado en el pipeline: ${operator}`);
            }

            // Ejecución polimórfica (soporta sync y async)
            result = await handler.execute(result, config);
        }

        return result;
    }
    public track(doc: SheetDocument<any>) {
        this.identityMap.set(this.getDocId(doc), doc);
    }

    // Cuando el engine crea un documento, lo "trackea"
    public createDocument(data: any, entityClass: any, row?: number): SheetDocument<T> {
        const doc = new SheetDocument(data, entityClass, row);
        doc.attach({ flush: () => this.flush(doc) });
        return doc;
    }

    public markDirty(doc: SheetDocument<any>) {
        this.unitOfWork.add(doc);
    }

    async flush(doc: SheetDocument<any>) {
        // Ahora doc.entityClass existe y TypeScript no se quejará
        const repoToken = getRepositoryToken(doc.entityClass);
        const repo = this.moduleRef.get<SheetsRepository<any>>(repoToken);

        if (!repo) {
            throw new Error(`No se encontró repositorio para la entidad: ${doc.entityClass.name}`);
        }

        // Pedimos al Repository la fila plana usando el método que definimos anteriormente
        const flatRow = await repo.serialize(doc);

        if (doc.isNew) {
            const rowNumber = await repo.gateway.appendRow(repo.sheetName, flatRow);
            doc.__commit(rowNumber);
        } else if (doc.isDirty) {
            await repo.gateway.updateRow(repo.sheetName, doc.rowNumber!, flatRow);
            doc.__commit();
        }
    }
}
