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
import { QueryEngine } from '@sheetOdm/engines/query.engine';
import { SheetDataTransformer } from '@sheetOdm/core/base/sheetDataTransformer';
import { ValidationEngine } from '@sheetOdm/engines/ValidationEngine';
import { MutationEngine } from '@sheetOdm/engines/mutationEngine';
import { WalManagerService } from '@sheetOdm/services/wal-manager.service';
import { IdGenerator } from '@sheetOdm/core/utils/idgenerator';
import { GasService } from '@sheetOdm/core/base/services/gas.service';


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
        private readonly gasService: GasService,
        public readonly gateway: SheetDataGateway,
        public readonly entityClass: ClassType<T>,
        protected readonly relationManager: RelationManager,
        private readonly moduleRef: ModuleRef,
        protected readonly hydrator: SheetDocumentHydrator,
        protected readonly unitOfWork: UnitOfWork,
        protected readonly dataMapper: DataMapper,
        private readonly walManager: WalManagerService,

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
        // 1. INTENTO POR RUTA RÁPIDA PARA MULTIPLES
        if (filter && Object.keys(filter).length === 1 && (!options || !options.sort)) {
            const columnName = Object.keys(filter)[0];
            const searchValue = filter[columnName];

            if (typeof searchValue === 'string' || typeof searchValue === 'number') {
                try {
                    const rawArray = await this.gasService.findMany<any>(this.sheetName, columnName, String(searchValue));

                    if (rawArray && rawArray.length > 0) {
                        // Pasamos los datos crudos por el QueryEngine local por si hay paginación (limit, skip)
                        const processedItems = await this.queryEngine.execute(rawArray, filter, options);

                        // Transformamos y guardamos en caché
                        return processedItems.map(raw => this.hydrateAndCacheRawResult(raw, options));
                    }
                    return [];
                } catch (error) {
                    this.logger.warn(`[Fallback] GAS falló en findMany. Error: ${error.message}`);
                }
            }
        }

        // 2. RUTA LENTA (Fetch a toda la hoja)
        const rawItems = await this.fetchRawData(options?.includeInactive); // Tu fetchRawData ya inyecta ROW_INDEX_SYMBOL
        const processedItems = await this.queryEngine.execute(rawItems, filter, options);

        // Guardamos todo el resultado en el Caché
        return processedItems.map(raw => this.hydrateAndCacheRawResult(raw, options));
    }

    async findOne(filter?: FilterQuery<T>, options?: Pick<QueryOptions<T>, 'includeInactive' | 'customConstructor'>): Promise<SheetDocument<T> | null> {
        // 1. INTENTO POR RUTA RÁPIDA (GasService / Índice Binario)
        if (filter && Object.keys(filter).length === 1) {
            const columnName = Object.keys(filter)[0];
            const searchValue = filter[columnName];

            if (typeof searchValue === 'string' || typeof searchValue === 'number') {
                try {
                    // Datos crudos directos de GAS (Incluyen la propiedad { _row })
                    const rawData = await this.gasService.findOne<any>(this.sheetName, columnName, String(searchValue));

                    if (rawData) {
                        this.logger.debug(`[Cache Hit - GAS] Registro encontrado en ${this.sheetName}`);
                        // Transformamos el _row y lo guardamos en el Caché (UnitOfWork)
                        return this.hydrateAndCacheRawResult(rawData, options);
                    }
                    return null;
                } catch (error) {
                    this.logger.warn(`[Fallback] GAS falló, usando escaneo completo. Error: ${error.message}`);
                }
            }
        }

        // 2. RUTA LENTA (Gateway Escaneo Completo)
        // El método find() ya se encarga de guardar los resultados en el caché
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
        if (operations.length === 0) return;

        const inserts = operations.filter(op => op.type === 'INSERT');
        const updates = operations.filter(op => op.type === 'UPDATE');
        const deletes = operations.filter(op => op.type === 'DELETE');

        // ====================================================================
        // FASE 1: WRITE-AHEAD LOGGING (REGISTRO DE INTENCIÓN EN DISCO)
        // ====================================================================
        const batchId = `batch_${Date.now()}`;
        const walTxIds: string[] = [];

        // Guardamos la intención de todo el lote antes de tocar la red
        for (const op of operations) {
            // Asumimos que doc.id o alguna propiedad identificadora existe
            const entityId = op.doc.id || op.doc._id || `temp_${Math.random().toString(36).substring(7)}`;
            const txId = `${batchId}_${op.type}_${entityId}`;
            walTxIds.push(txId);

            const pkColumn = this.metadataRegistry.getPrimaryKeyColumnName(this.entityClass);
            if (!pkColumn) {
                throw new Error(`La entidad ${this.entityClass.name} no tiene una columna PK definida en el MetadataRegistry.`);
            }
            await this.walManager.logIntent({
                txId,
                sheetName: this.sheetName,
                action: op.type.toLowerCase() as 'insert' | 'update' | 'delete',
                pkColumn: pkColumn, // <--- Aquí estaba el error: faltaba este campo
                entityId: entityId,
                payload: op.doc.toObject()
            });
        }

        // ====================================================================
        // FASE 2: EJECUCIÓN DEL LOTE (LA ZONA DE PELIGRO DE RED)
        // ====================================================================
        try {
            // --- 1. PROCESAR ELIMINACIONES (DELETES) ---
            const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(this.entityClass);
            const hardDeleteRanges: string[] = [];
            const softDeleteUpdates: { range: string; values: any[][] }[] = [];

            for (const op of deletes) {
                const doc = op.doc;
                const rowIndex = doc[ROW_INDEX_SYMBOL];
                if (!rowIndex) continue;

                if (deleteControlProp) {
                    // Borrado lógico (Soft Delete)
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
                    // Borrado físico (Hard Delete)
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

                const allocatedRowIndices = await this.gateway.appendRows(this.sheetName, rowsToInsert);

                inserts.forEach((op, index) => {
                    const doc = op.doc;
                    const allocatedIndex = allocatedRowIndices[index];
                    if (allocatedIndex) {
                        doc.markAsSaved(allocatedIndex);
                        doc.setVersion(initialVersion);
                    }
                });
            }

            // ====================================================================
            // FASE 3: CONFIRMACIÓN DEL WAL (ÉXITO)
            // ====================================================================
            // Si llegamos aquí, la red no falló y Google aceptó todo.
            for (const txId of walTxIds) {
                await this.walManager.markCompleted(txId);
            }

            // Invalidación reactiva
            await this.invalidateCache();

        } catch (error: any) {
            // ====================================================================
            // FASE 4: MANEJO DE CAÍDAS DE RED / ERRORES API
            // ====================================================================
            this.logger.error(`Fallo crítico durante la ejecución del lote [${batchId}]: ${error.message}`);

            // NO llamamos a markCompleted(). Los registros quedan como PENDING en el archivo .log.
            // El UnitOfWork arrojará este error hacia arriba, provocando que la memoria local 
            // no se considere "guardada". El motor WAL se encargará de esto en el próximo reinicio.

            throw error;
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
    /**
         * Transforma un registro crudo (POJO) en una instancia reactiva de SheetDocument.
         * Utiliza el UnitOfWork para garantizar el patrón Identity Map (Singleton por registro).
         */
    protected hydrateRawResult<U extends SheetDocument<T> = SheetDocument<T>>(
        rawObject: any,
        options?: Pick<QueryOptions<T>, 'customConstructor'>
    ): U {
        try {
            // 1. Identificar la llave primaria
            const pkField = this.getPrimaryKeyField();
            const pkValue = rawObject[pkField];

            // 2. Patrón Identity Map (¡Crítico!)
            // Si el documento ya está en el UnitOfWork, DEBEMOS devolver esa misma referencia.
            // Si creamos uno nuevo, podríamos sobreescribir cambios no guardados (isDirty = true)
            // que otro servicio esté realizando en memoria en esta misma transacción.
            if (pkValue) {
                const existingDoc = this.unitOfWork.get(pkValue, this.entityClass);
                if (existingDoc) {
                    return existingDoc as U;
                }
            }

            let doc: SheetDocument<T>;

            // 3. Estrategia de Instanciación
            if (options?.customConstructor) {
                // Modo Constructor Manual (Custom Wrapper)
                doc = new options.customConstructor(rawObject, this, false);

                // Mapeo defensivo de propiedades de infraestructura
                const rowIndex = rawObject[ROW_INDEX_SYMBOL] || rawObject._rowIndex;
                doc.markAsSaved(rowIndex);

                const version = this.extractVersionFromRawObject(rawObject);
                doc.setVersion(version);
            } else {
                // Modo Automático (Uso del Hydrator Base)
                // Tu hydrator ya se encarga de inyectar el Proxy y los getters/setters
                doc = this.hydrator.hydrateAndShield(this.entityClass, this, rawObject);
            }

            // 4. Registro en el Identity Map para futuras consultas
            if (pkValue) {
                this.unitOfWork.register(doc, pkValue, this.entityClass);
            }

            return doc as U;

        } catch (error: any) {
            this.logger.error(
                `[Hydrator] Error al hidratar registro en '${this.sheetName}'. ID: ${rawObject[this.getPrimaryKeyField()]}. Detalles: ${error.message}`,
                error.stack
            );
            // Lanzamos una excepción controlada para no enmudecer fallos de esquema
            throw new Error(`Fallo de integridad estructural al instanciar la entidad ${this.entityClass.name}.`);
        }
    }

    /**
     * Extrae de forma segura la versión del objeto crudo, independientemente 
     * de cómo lo haya devuelto Google Sheets o el motor GAS.
     */
    private extractVersionFromRawObject(rawObject: any): number {
        // Primero intentamos la propiedad directa (si viene del Gateway)
        if (rawObject.version !== undefined && rawObject.version !== null) {
            return parseInt(rawObject.version, 10);
        }

        // Si no está, buscamos por el nombre de la columna definida en los metadatos
        const versionField = this.metadataRegistry.getVersionField(this.entityClass);
        if (versionField && rawObject[versionField] !== undefined) {
            return parseInt(rawObject[versionField], 10) || 0;
        }

        return 0; // Valor por defecto si no maneja versiones
    }
    protected hydrateAndCacheRawResult<U extends SheetDocument<T> = SheetDocument<T>>(
        rawObject: any,
        options?: QueryOptions<T>
    ): U {
        // 1. TRADUCCIÓN VITAL: GAS -> Símbolo Interno
        // Transformamos el _row de Apps Script al Símbolo interno que usa tu motor
        if (rawObject._row !== undefined && rawObject._row !== null) {
            rawObject[ROW_INDEX_SYMBOL] = rawObject._row;
            delete rawObject._row; // Limpiamos para mantener el POJO puro
        }

        const pkField = this.getPrimaryKeyField();
        const pkValue = rawObject[pkField];

        // 2. MODO LEAN (Bypass del UnitOfWork)
        // Si el usuario solo quiere leer masivamente sin mutar, instanciamos y retornamos directo.
        // Esto salva la memoria RAM al no registrar miles de objetos en el Identity Map.
        if (options?.lean) {
            return this.instantiateDocument<U>(rawObject, options);
        }

        // 3. VALIDACIÓN DE CACHÉ (Identity Map)
        // Si no es lean, protegemos los datos en memoria: si ya existe en esta transacción,
        // devolvemos la misma referencia para no aplastar cambios locales no guardados.
        if (pkValue) {
            const existingDoc = this.unitOfWork.get(pkValue, this.entityClass);
            if (existingDoc) {
                return existingDoc as U;
            }
        }

        // 4. HIDRATACIÓN ESTÁNDAR
        // Creamos la instancia reactiva (Proxy)
        const doc = this.instantiateDocument<U>(rawObject, options);

        // 5. REGISTRO EN CACHÉ (UnitOfWork)
        // Guardamos la nueva referencia para futuras consultas en esta misma petición
        if (pkValue) {
            this.unitOfWork.register(doc, pkValue, this.entityClass);
        }

        return doc;
    }

    /**
     * Método auxiliar privado: Centraliza la instanciación de la entidad.
     * Aísla la lógica de creación para que hydrateAndCacheRawResult se enfoque en la orquestación.
     */
    private instantiateDocument<U extends SheetDocument<T>>(
        rawObject: any,
        options?: QueryOptions<T>
    ): U {
        let doc: SheetDocument<T>;

        try {
            if (options?.customConstructor) {
                // Modo Constructor Manual (Custom Wrapper)
                doc = new options.customConstructor(rawObject, this, false);
                doc.markAsSaved(rawObject[ROW_INDEX_SYMBOL]);

                // Extracción segura de la versión
                const version = rawObject.version !== undefined
                    ? parseInt(rawObject.version, 10)
                    : 0;
                doc.setVersion(version);
            } else {
                // Modo Automático (Hydrator base inyecta el Proxy y los interceptores)
                doc = this.hydrator.hydrateAndShield(this.entityClass, this, rawObject);
            }

            return doc as U;
        } catch (error: any) {
            this.logger.error(
                `[Hydrator] Error crítico al instanciar registro en '${this.sheetName}'. ID: ${rawObject[this.getPrimaryKeyField()]}. Detalles: ${error.message}`,
                error.stack
            );
            throw new Error(`Fallo estructural al hidratar la entidad ${this.entityClass.name}.`);
        }
    }
    private prepareSerializedRow(doc: any): any[] {
        const columnNames = this.metadataRegistry.getColumnNamesForGas(this.entityClass);
        const obj = doc.toObject();

        // Esto garantiza que el array resultante siempre tenga el orden de las columnas de la hoja
        return columnNames.map(colName => obj[colName] ?? null);
    }
}

