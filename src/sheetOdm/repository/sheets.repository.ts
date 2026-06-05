import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';

import { ClassType, FilterQuery, FindOneAndUpdateOptions, PopulateOptions, QueryOptions, UpdateQuery } from '@sheetOdm/types/query.types';
import { ROW_INDEX_SYMBOL, SHEETS_REPOSITORY_MARKER, SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import * as Joi from 'joi';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { DataMapper } from '@sheetOdm/services/data-mapper.service';
import { RelationManager } from '@sheetOdm/services/relation-manager.service';

import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator';

import { ModuleRef } from '@nestjs/core';
import { getRepositoryToken } from '@sheetOdm/utils/helper';
import { SheetDocument } from '@sheetOdm/wrapper/sheetDocument';
import { UnitOfWork } from '@sheetOdm/services/UnitOfWork';
import { IdGenerator } from '@sheetOdm/utils/id.generator';
import { QueryEngine } from '@sheetOdm/engines/query.engine';
import { SheetDataTransformer } from '@sheetOdm/core/base/sheetDataTransformer';
import { ValidationEngine } from '@sheetOdm/engines/ValidationEngine';
import { MutationEngine } from '@sheetOdm/engines/mutationEngine';


// Registro global auxiliar para resolver inyecciones circulares entre repositorios en populate

@Injectable()
export class SheetsRepository<T extends object> {

    readonly logger = new Logger(SheetsRepository.name);
    public readonly [SHEETS_REPOSITORY_MARKER] = true;
    public headers: string[] = [];

    constructor(

        protected readonly metadataRegistry: MetadataRegistry,
        protected readonly queryEngine: QueryEngine,
        protected readonly mutationEngine: MutationEngine,       // 💉 Inyectado
        protected readonly validationEngine: ValidationEngine,   // 💉 Inyectado
        protected readonly transformer: SheetDataTransformer,    // 💉 Inyectado
        public readonly gateway: SheetDataGateway,
        public readonly entityClass: ClassType<T>,
        protected readonly relationManager: RelationManager,
        private readonly moduleRef: ModuleRef,
        protected readonly hydrator: SheetDocumentHydrator,
        protected readonly unitOfWork: UnitOfWork,
        protected readonly dataMapper: DataMapper

    ) { }

    // =========================================================================
    // GETTERS BÁSICOS
    // =========================================================================

    public get sheetName(): string {
        return (Reflect.getMetadata(SHEETS_TABLE_NAME, this.entityClass) || this.entityClass.name).toUpperCase();
    }

    public getPrimaryKeyField(): string {
        return this.metadataRegistry.getPrimaryKeyField(this.entityClass);
    }

    // =========================================================================
    // API PÚBLICA DE LECTURA
    // =========================================================================

    async find(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<SheetDocument<T>[]> {
        const rawItems = await this.fetchRawData(options?.includeInactive);
        const processedItems = await this.queryEngine.execute(rawItems, filter, options);

        return processedItems.map(raw => {
            const pk = raw[this.getPrimaryKeyField()];
            let doc = this.unitOfWork.get(pk, this.entityClass);

            if (!doc) {
                if (options?.customConstructor) {
                    doc = new options.customConstructor(raw, this, false);
                    doc.markAsSaved(raw[ROW_INDEX_SYMBOL]);
                    doc.setVersion(raw.version || 0);
                } else {
                    doc = this.hydrator.hydrateAndShield(this.entityClass, this, raw);
                }

                if (pk) this.unitOfWork.register(doc, pk, this.entityClass);
            }
            return doc;
        });
    }

    async findOne(filter?: FilterQuery<T>, options?: Pick<QueryOptions<T>, 'includeInactive' | 'customConstructor'>): Promise<SheetDocument<T> | null> {
        const results = await this.find(filter, { limit: 1, ...options });
        return results.length > 0 ? results[0] : null;
    }

    async aggregate<R = any>(pipeline: any[]): Promise<R[]> {
        try {
            const rawItems = await this.fetchRawData(false);
            return await this.queryEngine.aggregate(rawItems, pipeline) as R[];
        } catch (error: any) {
            this.logger.error(`❌ Error en aggregate() en "${this.sheetName}": ${error.message}`);
            throw error;
        }
    }

    // =========================================================================
    // API PÚBLICA DE ESCRITURA
    // =========================================================================

    create(data: Partial<T>): SheetDocument<T> {
        return this.hydrator.hydrateAndShield(this.entityClass, this, data, { new: true })!;
    }

    async save(doc: SheetDocument<T>): Promise<SheetDocument<T>> {
        // 1. Autogenerar IDs si es necesario
        if (!doc[ROW_INDEX_SYMBOL]) {
            await this.applyAutogeneratedFields(doc);
        }

        // 2. Procesar cascadas
        await this.processCascadeSave(doc);

        // 🛡️ 3. VALIDACIÓN CORREGIDA (Pasando el array de errores)
        const errors: string[] = []; // Inicializamos el array vacío

        // El ValidationEngine mutará este array si encuentra errores
        this.validationEngine.validate(this.entityClass, doc.toObject(), errors);

        // Si el array ya no está vacío, lanzamos la excepción
        if (errors.length > 0) {
            throw new BadRequestException(
                `Errores de validación en ${this.sheetName}: ${errors.join(', ')}`
            );
        }

        // 4. Integración Transaccional (UnitOfWork)
        if (this.unitOfWork.hasActiveTransaction()) {
            const isAlreadyQueued = this.unitOfWork.getPendingOperations().some(op => op.doc === doc);
            if (!isAlreadyQueued) {
                const type = doc[ROW_INDEX_SYMBOL] ? 'UPDATE' : 'INSERT';
                this.unitOfWork.queueOperation({
                    type,
                    entityClass: this.entityClass,
                    sheetName: this.sheetName,
                    doc
                });
            }
            return doc;
        }

        // 5. Guardado físico directo si no hay transacción
        const rowNumber = doc[ROW_INDEX_SYMBOL];
        if (!rowNumber) {
            return await this.insertDocument(doc);
        }
        return await this.updateDocument(doc, rowNumber);
    }
    async update(filter: FilterQuery<T>, updateData: Partial<T>): Promise<SheetDocument<T> | null> {
        const doc = await this.findOne(filter);
        if (!doc) return null;

        // 🛠️ USO DEL MUTATION ENGINE PARA OPERADORES ($inc, $set, etc.)
        const mutatedData = this.mutationEngine.mutate(updateData, doc.toObject());
        Object.assign(doc, mutatedData);

        return await this.save(doc);
    }

    async findOneAndUpdate<U extends SheetDocument<T> = SheetDocument<T>>(
        filter: FilterQuery<T>,
        update: UpdateQuery<T>,
        options: FindOneAndUpdateOptions<T, U> = {}
    ): Promise<U | null> {
        const found = await this.findOne(filter, {
            includeInactive: options.includeInactive,
            customConstructor: options.customConstructor as any
        }) as U | null;

        if (!found) {
            if (options.upsert) {
                const createData = { ...filter, ...(update.$set || update) };
                const newDoc = this.create(createData) as U;
                return await newDoc.save() as U;
            }
            return null;
        }

        // 🛠️ USO DEL MUTATION ENGINE (Sustituye tu bucle manual de $inc)
        const mutatedData = this.mutationEngine.mutate(update, found.toObject());
        Object.assign(found, mutatedData);

        const saved = await found.save();
        return options.new !== false ? (saved as U) : found;
    }

    async delete(filter: FilterQuery<T>): Promise<boolean> {
        const doc = await this.findOne(filter);
        if (!doc) return false;

        await this.processCascadeDelete(doc);

        if (this.unitOfWork.hasActiveTransaction()) {
            this.unitOfWork.queueOperation({ type: 'DELETE', entityClass: this.entityClass, sheetName: this.sheetName, doc });
            return true;
        }

        const rowIndex = doc[ROW_INDEX_SYMBOL];
        const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(this.entityClass);

        if (deleteControlProp) {
            (doc as any)[deleteControlProp] = true;
            await this.save(doc);
        } else if (rowIndex) {
            await this.gateway.clearRow(this.sheetName, rowIndex);
        }
        return true;
    }

    // =========================================================================
    // MÉTODOS PRIVADOS Y DE INFRAESTRUCTURA
    // =========================================================================

    protected async fetchRawData(includeInactive = false): Promise<any[]> {
        const allRows = await this.gateway.getRange(`${this.sheetName}!A1:Z10000`);
        if (!allRows || allRows.length === 0) return [];

        const headers = allRows[0].map((h: any) => String(h).trim().toUpperCase());
        const dataRows = allRows.slice(1);
        const schema = this.metadataRegistry.getSchema(this.entityClass);

        // 🚀 MAPEO DIRECTO ARRAY -> OBJETO (Eliminamos el DataMapper)
        let items = dataRows.map((row, index) => {
            const plainObject: any = {};
            plainObject[ROW_INDEX_SYMBOL] = index + 2;

            for (const prop of Object.keys(schema.columns)) {
                const colConfig = schema.columns[prop];
                const headerName = (colConfig.name || prop).toUpperCase();
                const colIndex = headers.indexOf(headerName);

                plainObject[prop] = colIndex !== -1 ? row[colIndex] : (colConfig.default ?? null);
            }
            return plainObject;
        });

        const deleteControlProp = schema.deleteControl;
        if (deleteControlProp && !includeInactive) {
            items = items.filter(item => !item[deleteControlProp]);
        }
        return items;
    }

    private prepareDataWithVersion(dataObject: any, newVersion: number): any[] {
        const versionField = this.metadataRegistry.getVersionField(this.entityClass);
        const schema = this.metadataRegistry.getSchema(this.entityClass);

        return schema.columnList.map(columnName => {
            if (columnName === versionField) return newVersion;

            const rawValue = dataObject[columnName];
            // Inferimos el tipo desde el decorador @Column de tu metadata
            const colType = schema.columns[columnName]?.type || 'string';

            // 🛡️ SERIALIZACIÓN SEGURA: Usamos tu transformer real
            return this.transformer.prepareValueForSheet(rawValue, colType);
        });
    }


    public async getRowIndexById(id: string | number): Promise<number> {
        const primaryKeyProp = this.getPrimaryKeyField();
        const allEntities = await this.fetchRawData(true);
        const item = allEntities.find(item => String(item[primaryKeyProp]) === String(id));

        return item ? (item[ROW_INDEX_SYMBOL] ?? -1) : -1;
    }

    // =========================================================================
    // API PÚBLICA DE ESCRITURA (ESTILO MONGOOSE)
    // =========================================================================





    // =========================================================================
    // UTILIDADES PÚBLICAS Y CACHÉ
    // =========================================================================

    async populate(entity: T, relationField: string): Promise<T> {
        const options: PopulateOptions<T> = {
            path: relationField as any
        };
        await this.relationManager.populate([entity], this.entityClass, [options]);
        return entity;
    }

    public async invalidateCache(): Promise<void> {
        this.unitOfWork.clearByEntity(this.entityClass);
        this.logger.debug(`[Cache] Cache invalidado para ${this.entityClass.name}`);
    }

    public async serialize(doc: SheetDocument<T>): Promise<any[]> {
        const headers = await this.getCurrentSheetHeaders();
        return this.dataMapper.toFlatRow(doc.toObject(), this.entityClass, headers);
    }

    async flush(): Promise<void> {
        const dirtyDocs = this.unitOfWork.getAll().filter((doc: any) => doc.isDirty);

        if (dirtyDocs.length === 0) return;

        this.logger.debug(`[Flush] Persistiendo ${dirtyDocs.length} documentos...`);

        await Promise.all(dirtyDocs.map(async (doc) => {
            try {
                await doc.save();
            } catch (error: any) {
                this.logger.error(`[Flush] Error al guardar documento: ${error.message}`);
                throw error;
            }
        }));
    }

    // =========================================================================
    // MÉTODOS PRIVADOS (LÓGICA INTERNA)
    // =========================================================================



    private async getCurrentSheetHeaders(): Promise<string[]> {
        const headerRows = await this.gateway.getRange(`${this.sheetName}!A1:Z1`);
        return headerRows[0] ? headerRows[0].map((h: any) => String(h).trim().toUpperCase()) : [];
    }

    private async insertDocument(doc: SheetDocument<T>): Promise<SheetDocument<T>> {
        await this.applyAutogeneratedFields(doc);
        const initialVersion = 1;
        const valuesToSave = this.prepareDataWithVersion(doc.toObject(), initialVersion);

        const newRowIndex = await this.gateway.appendRow(this.sheetName, valuesToSave);
        await this.invalidateCache();

        doc.markAsSaved(newRowIndex);
        doc.setVersion(initialVersion);
        return doc;
    }

    private async updateDocument(doc: SheetDocument<T>, rowNumber: number): Promise<SheetDocument<T>> {
        const currentData = await this.gateway.getRowData(this.sheetName, rowNumber);
        const currentVersionInSheet = this.extractVersionFromRow(currentData);

        if (currentVersionInSheet !== doc.version) {
            throw new Error(
                `Concurrency Conflict: La fila ${rowNumber} fue modificada por otro proceso. ` +
                `Tu versión: ${doc.version}, Versión en Sheets: ${currentVersionInSheet}`
            );
        }

        const nextVersion = doc.version + 1;
        const valuesToSave = this.prepareDataWithVersion(doc.toObject(), nextVersion);

        await this.gateway.updateRow(this.sheetName, rowNumber, valuesToSave);

        doc.markAsSaved(rowNumber);
        doc.setVersion(nextVersion);
        return doc;
    }

    private async applyAutogeneratedFields(doc: SheetDocument<T>): Promise<void> {
        const schema = this.metadataRegistry.getSchema(this.entityClass);

        for (const key of Object.keys(schema.columns)) {
            const config = schema.columns[key];
            if (!config.generated && !config.isAutoIncrement) continue;

            const currentValue = (doc as any)[key];
            if (currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== '') continue;

            if (config.generated === 'uuid') {
                (doc as any)[key] = IdGenerator.generate();
            } else if (config.generated === 'short-id') {
                (doc as any)[key] = IdGenerator.generateShort();
            } else if (config.isAutoIncrement || config.generated === 'increment') {
                try {
                    const allRecords = await this.fetchRawData(true);
                    const maxId = allRecords.reduce((max, item) => {
                        const val = parseInt(item[key], 10);
                        return (!isNaN(val) && val > max) ? val : max;
                    }, 0);
                    (doc as any)[key] = maxId + 1;
                } catch (e: any) {
                    this.logger.warn(`[AutoIncrement] Fallback a id = 1 en '${key}'. Motivo: ${e.message}`);
                    (doc as any)[key] = 1;
                }
            } else {
                (doc as any)[key] = IdGenerator.generate();
            }
        }
    }

    private async processCascadeDelete(doc: SheetDocument<T>): Promise<void> {
        const schema = this.metadataRegistry.getSchema(this.entityClass);
        const parentId = (doc as any)[schema.primaryKey];

        for (const relationField of schema.relations) {
            const config = this.metadataRegistry.getRelationOptions(this.entityClass, relationField);
            if (!config || !config.targetEntity) continue;

            const targetEntityClass = config.targetEntity();
            const joinColumn = config.joinColumn || `${this.entityClass.name.toLowerCase()}Id`;
            const strategy = config.onDelete || 'RESTRICT';

            const repoToken = getRepositoryToken(targetEntityClass);
            let childRepo: SheetsRepository<any>;

            try {
                childRepo = this.moduleRef.get<SheetsRepository<any>>(repoToken, { strict: false });
            } catch (error) {
                this.logger.warn(`⚠️ Repositorio no encontrado para la cascada: ${targetEntityClass.name}`);
                continue;
            }

            const children = await childRepo.find({ [joinColumn]: parentId } as any);
            const dependentCount = children.length;

            if (dependentCount === 0) continue;

            const childPk = childRepo.getPrimaryKeyField();

            switch (strategy) {
                case 'RESTRICT':
                    throw new BadRequestException(
                        `Restricción de Integridad: No se puede eliminar el registro en [${this.sheetName}] porque tiene ${dependentCount} registros vinculados en [${childRepo.sheetName}].`
                    );

                case 'SET_NULL':
                    await Promise.all(children.map(child =>
                        childRepo.findOneAndUpdate(
                            { [childPk]: (child as any)[childPk] } as any,
                            { $set: { [joinColumn]: null } } as any
                        )
                    ));
                    this.logger.log(`🔄 Integridad SET_NULL: [${dependentCount}] hijos desenlazados.`);
                    break;

                case 'CASCADE':
                    await Promise.all(children.map(child =>
                        childRepo.delete({ [childPk]: (child as any)[childPk] } as any)
                    ));
                    this.logger.log(`✅ Integridad CASCADE: [${dependentCount}] hijos eliminados.`);
                    break;

                default:
                    throw new Error(`[SheetsRepository] Estrategia onDelete '${strategy}' no soportada.`);
            }
        }
    }


    private extractVersionFromRow(rowData: any[]): number {
        const versionField = this.metadataRegistry.getVersionField(this.entityClass);
        if (!versionField) return 0;

        const columnMap = this.metadataRegistry.getColumnMap(this.entityClass);
        const index = columnMap[versionField];

        if (index === undefined) {
            throw new Error(
                `Error de configuración: La entidad ${this.entityClass.name} tiene un decorador @Version en '${versionField}' ` +
                `pero no está mapeado como una @Column válida.`
            );
        }
        return parseInt(rowData[index] || 0, 10);
    }


    // Clon conceptual a implementar antes del volcado físico en SheetsRepository
    private async processCascadeSave(doc: SheetDocument<T>): Promise<void> {
        const schema = this.metadataRegistry.getSchema(this.entityClass);

        for (const relationField of schema.relations) {
            const config = this.metadataRegistry.getRelationOptions(this.entityClass, relationField);
            const relatedData = (doc as any)[relationField];

            // Si no hay datos adjuntos/hidratados en esta propiedad durante este save, ignoramos
            if (!relatedData) continue;

            const targetEntityClass = config.targetEntity();
            // Obtenemos el repositorio hijo desde el contenedor de NestJS
            const childRepo = this.moduleRef.get<SheetsRepository<any>>(
                getRepositoryToken(targetEntityClass),
                { strict: false }
            );

            if (config.isMany && Array.isArray(relatedData)) {
                // ESCENARIO 1: @SubCollection (Ej. Obrero guarda sus Adelantos[])
                const parentPkName = this.getPrimaryKeyField();
                const parentId = (doc as any)[parentPkName];

                await Promise.all(relatedData.map(async (child) => {
                    // Inyectamos el ID del padre (Obrero) en la FK del hijo (Adelanto.idObrero)
                    (child as any)[config.joinColumn] = parentId;
                    // La recursividad encolará este hijo en el UOW
                    return childRepo.save(child);
                }));

            } else if (!config.isMany && !Array.isArray(relatedData)) {
                // ESCENARIO 2: @Reference (Ej. Adelanto guarda la Referencia a su Obrero)
                // Guardamos el lado de la referencia primero para asegurar que tenga ID
                const savedReference = await childRepo.save(relatedData);
                const refPkName = childRepo.getPrimaryKeyField();

                // Actualizamos la FK en el documento actual apuntando al ID de la referencia salvada
                (doc as any)[config.joinColumn] = (savedReference as any)[refPkName];
            }
        }
    }
    async commitBulk(operations: any[]): Promise<void> {
        const inserts = operations.filter(op => op.type === 'INSERT');
        const updates = operations.filter(op => op.type === 'UPDATE');
        const deletes = operations.filter(op => op.type === 'DELETE');

        // --- 1. PROCESAR ELIMINACIONES (DELETES) ---
        const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(this.entityClass);
        const hardDeleteRanges: string[] = [];
        const softDeleteUpdates: { range: string; values: any[][] }[] = [];

        for (const op of deletes) {
            const doc = op.doc;
            const rowIndex = doc[ROW_INDEX_SYMBOL];
            if (!rowIndex) continue;

            if (deleteControlProp) {
                // Borrado lógico (Soft Delete) -> Se transforma en una actualización masiva
                (doc as any)[deleteControlProp] = true;
                const nextVersion = doc.version + 1;
                const serialized = this.prepareDataWithVersion(doc.toObject(), nextVersion);
                softDeleteUpdates.push({
                    range: `${this.sheetName}!A${rowIndex}`,
                    values: [serialized]
                });
                doc.setVersion(nextVersion);
                doc.markAsSaved(rowIndex);
            } else {
                // Borrado físico (Hard Delete) -> Limpieza de rango completa
                hardDeleteRanges.push(`${this.sheetName}!${rowIndex}:${rowIndex}`);
                doc.markAsSaved(undefined as any);
            }
        }

        if (hardDeleteRanges.length > 0) {
            await this.gateway.batchClearValues(hardDeleteRanges);
        }

        // --- 2. PROCESAR ACTUALIZACIONES (UPDATES + SOFT DELETES) ---
        const updatePayloads: { range: string; values: any[][] }[] = [...softDeleteUpdates];

        for (const op of updates) {
            const doc = op.doc;
            const rowIndex = doc[ROW_INDEX_SYMBOL];
            if (!rowIndex) continue;

            const nextVersion = doc.version + 1;
            const serialized = this.prepareDataWithVersion(doc.toObject(), nextVersion);

            updatePayloads.push({
                range: `${this.sheetName}!A${rowIndex}`,
                values: [serialized]
            });

            doc.setVersion(nextVersion);
            doc.markAsSaved(rowIndex);
        }

        if (updatePayloads.length > 0) {
            await this.gateway.batchUpdateValues(updatePayloads);
        }

        // --- 3. PROCESAR INSERCIONES (INSERTS) ---
        if (inserts.length > 0) {
            const initialVersion = 1;
            const rowsToInsert: any[][] = [];

            for (const op of inserts) {
                const serialized = this.prepareDataWithVersion(op.doc.toObject(), initialVersion);
                rowsToInsert.push(serialized);
            }

            // Envío en bloque y recuperación de los Row Indexes de Google Sheets
            const allocatedRowIndices = await this.gateway.appendRows(this.sheetName, rowsToInsert);

            // Mutar los documentos originales con sus IDs e índices físicos reales asignados por Google
            inserts.forEach((op, index) => {
                const doc = op.doc;
                const allocatedIndex = allocatedRowIndices[index];
                if (allocatedIndex) {
                    doc.markAsSaved(allocatedIndex);
                    doc.setVersion(initialVersion);
                }
            });
        }

        // Invalidación reactiva de la caché local para esta entidad tras mutaciones masivas
        if (operations.length > 0) {
            await this.invalidateCache();
        }
    }
    public getRelationManager(): RelationManager {
        return this.relationManager;
    }
    public async executeBaseFind(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<SheetDocument<T>[]> {
        const rawItems = await this.fetchRawData(options?.includeInactive);
        const processedItems = await this.queryEngine.execute(rawItems, filter, options);

        return processedItems.map(raw => {
            const pk = raw[this.getPrimaryKeyField()];
            let doc = this.unitOfWork.get(pk, this.entityClass);
            if (!doc) {
                doc = this.hydrator.hydrateAndShield(this.entityClass, this, raw);
                if (pk) this.unitOfWork.register(doc, pk, this.entityClass);
            }
            return doc;
        });
    }





}

