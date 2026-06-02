import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';

import { ClassType, FilterQuery, FindOneAndUpdateOptions, QueryOptions, UpdateQuery } from '@sheetOdm/types/query.types';
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


// Registro global auxiliar para resolver inyecciones circulares entre repositorios en populate

@Injectable()
export class SheetsRepository<T extends object> {

    readonly logger = new Logger(SheetsRepository.name);
    public readonly [SHEETS_REPOSITORY_MARKER] = true;
    public headers: string[] = [];

    constructor(

        protected readonly metadataRegistry: MetadataRegistry,
        protected readonly queryEngine: QueryEngine,
        public readonly gateway: SheetDataGateway,
        public readonly entityClass: ClassType<T>,
        protected readonly relationManager: RelationManager,
        protected readonly dataMapper: DataMapper,
        private readonly moduleRef: ModuleRef,
        protected readonly hydrator: SheetDocumentHydrator,
        protected readonly unitOfWork: UnitOfWork

    ) {

    }


    public get sheetName(): string {
        return (Reflect.getMetadata(SHEETS_TABLE_NAME, this.entityClass) || this.entityClass.name).toUpperCase();
    }

    public getPrimaryKeyField(): string {
        return this.metadataRegistry.getPrimaryKeyField(this.entityClass);
    }

    protected async fetchRawData(includeInactive = false): Promise<any[]> {
        const allRows = await this.gateway.getRange(`${this.sheetName}!A1:Z10000`);
        if (!allRows || allRows.length === 0) return [];

        const headers = allRows[0].map((h: any) => String(h).trim().toUpperCase());
        const dataRows = allRows.slice(1);

        let items = dataRows.map((row, index) =>
            this.dataMapper.toPlainObject(row, this.entityClass, headers, index + 2)
        );

        const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(this.entityClass);
        if (deleteControlProp && !includeInactive) {
            items = items.filter(item => !item[deleteControlProp]);
        }
        return items;
    }

    private async getCurrentSheetHeaders(): Promise<string[]> {
        const headerRows = await this.gateway.getRange(`${this.sheetName}!A1:Z1`);
        return headerRows[0] ? headerRows[0].map((h: any) => String(h).trim().toUpperCase()) : [];
    }
    async find(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<SheetDocument<T>[]> {
        const rawItems = await this.fetchRawData(options?.includeInactive);
        const processedItems = await this.queryEngine.execute(rawItems, filter, options);

        return processedItems.map(raw => {
            const pk = raw[this.getPrimaryKeyField()];

            // ✅ Corregido: Pasamos this.entityClass para identificar el tipo
            let doc = this.unitOfWork.get(pk, this.entityClass);

            if (!doc) {
                if (options?.customConstructor) {
                    doc = new options.customConstructor(raw, this, false);
                    doc.markAsSaved(raw[ROW_INDEX_SYMBOL]);
                    doc.setVersion(raw.version || 0);
                } else {
                    doc = this.hydrator.hydrateAndShield(this.entityClass, this, raw);
                }

                // ✅ Corregido: Pasamos this.entityClass al registrar
                if (pk) this.unitOfWork.register(doc, pk, this.entityClass);
            }
            return doc;
        });
    }



    async findOne(
        filter?: FilterQuery<T>,
        options?: Pick<QueryOptions<T>, 'includeInactive' | 'customConstructor'>
    ): Promise<SheetDocument<T> | null> {
        const results = await this.find(filter, { limit: 1, ...options });
        return results.length > 0 ? results[0] : null;
    }

    async aggregate<R = any>(pipeline: any[]): Promise<R[]> {
        try {
            const rawItems = await this.fetchRawData(false);
            return await this.queryEngine.aggregate(rawItems, pipeline) as R[];
        } catch (error) {
            this.logger.error(`❌ Error en aggregate() en "${this.sheetName}": ${error.message}`);
            throw error;
        }
    }

    create(data: Partial<T>): SheetDocument<T> {
        return this.hydrator.hydrateAndShield(this.entityClass, this, data, { new: true })!;
    }
    public async invalidateCache(): Promise<void> {
        // Esto solo borra las instancias en memoria de ESTA entidad (User, Product, etc.)
        // sin afectar a otras entidades que puedan estar en el mismo request.
        this.unitOfWork.clearByEntity(this.entityClass);

        this.logger.debug(`[Cache] Cache invalidado para ${this.entityClass.name}`);
    }

    async save(doc: SheetDocument<T>): Promise<SheetDocument<T>> {
        const sheetName = this.sheetName; // Usando el getter existente
        const rowNumber = doc[ROW_INDEX_SYMBOL]; // Usando el símbolo correcto

        // 1. CASO INSERT: Nuevo registro
        if (!rowNumber) {
            await this.applyAutogeneratedFields(doc);
            const initialVersion = 1;
            // Usamos prepareDataWithVersion también aquí para asegurar el orden de las columnas
            const valuesToSave = this.prepareDataWithVersion(doc.toObject(), initialVersion);

            const newRowIndex = await this.gateway.appendRow(sheetName, valuesToSave);
            await this.invalidateCache();
            doc.markAsSaved(newRowIndex);
            doc.setVersion(initialVersion);
            return doc;
        }

        // 2. CASO UPDATE: Bloqueo Optimista
        // A. Obtenemos datos crudos para validar la versión que existe actualmente en la nube
        const currentData = await this.gateway.getRowData(sheetName, rowNumber);
        const currentVersionInSheet = this.extractVersionFromRow(currentData);

        // B. Validación de Concurrencia
        if (currentVersionInSheet !== doc.version) {
            throw new Error(
                `Concurrency Conflict: La fila ${rowNumber} fue modificada por otro proceso. ` +
                `Tu versión: ${doc.version}, Versión en Sheets: ${currentVersionInSheet}`
            );
        }

        // C. Si las versiones coinciden, preparamos y guardamos
        const nextVersion = doc.version + 1;
        const valuesToSave = this.prepareDataWithVersion(doc.toObject(), nextVersion);

        await this.gateway.updateRow(sheetName, rowNumber, valuesToSave);

        // D. Actualizamos estado local
        doc.markAsSaved(rowNumber);
        doc.setVersion(nextVersion);

        return doc;
    }

    async update(filter: FilterQuery<T>, updateData: Partial<T>): Promise<SheetDocument<T> | null> {
        const doc = await this.findOne(filter);
        if (!doc) return null;

        const mergedData = { ...doc.toObject(), ...updateData };
        const validatedData = this.validateWithJoi(mergedData);

        Object.assign(doc, validatedData);
        return await this.save(doc);
    }

    /**
     * 🎯 SINTONÍA ESTILO MONGOOSE: findOneAndUpdate
     * Modifica atómicamente propiedades en memoria basándose en comandos estructurales ($set, $inc)
     */
    async findOneAndUpdate<U extends SheetDocument<T> = SheetDocument<T>>(
        filter: FilterQuery<T>,
        update: UpdateQuery<T>,
        options: FindOneAndUpdateOptions<T, U> = {}
    ): Promise<U | null> {
        // 1. Buscamos (Ahora el tipado de findOne permite pasar el customConstructor de forma transparente)
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

        // 2. Aplicamos cambios con los operadores
        const updatePayload = update.$set || update;

        if (update.$inc) {
            Object.keys(update.$inc).forEach(key => {
                const currentVal = Number((found as any)[key] || 0);
                const incValue = Number(update.$inc![key as keyof T] || 0);

                (updatePayload as any)[key] = currentVal + incValue;
            });
        }

        Object.assign(found, updatePayload);

        // 3. Persistimos
        const saved = await found.save();

        return options.new !== false ? (saved as U) : found;
    }
    public async getRowIndexById(id: string | number): Promise<number> {
        const primaryKeyProp = this.metadataRegistry.getPrimaryKeyField(this.entityClass);

        // Obtenemos los datos frescos desde el gateway usando fetchRawData
        // (Incluimos inactivos por si se busca un registro eliminado)
        const allEntities = await this.fetchRawData(true);

        const item = allEntities.find(
            (item) => String(item[primaryKeyProp]) === String(id)
        );

        // 💡 Ya no necesitamos hacer el cálculo manual "+ 2", 
        // porque el dataMapper ya inyectó el ROW_INDEX_SYMBOL en cada objeto.
        return item ? (item[ROW_INDEX_SYMBOL] ?? -1) : -1;
    }
    async delete(filter: FilterQuery<T>): Promise<boolean> {
        const doc = await this.findOne(filter);
        if (!doc) return false;

        await this.processCascadeDelete(doc);

        const rowIndex = doc[ROW_INDEX_SYMBOL];
        const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(this.entityClass);

        if (deleteControlProp) {
            (doc as any)[deleteControlProp] = true;
            await this.save(doc);
        } else {
            if (rowIndex) await this.gateway.clearRow(this.sheetName, rowIndex);
        }
        return true;
    }

    private async applyAutogeneratedFields(doc: SheetDocument<T>): Promise<void> {
        const schema = this.metadataRegistry.getSchema(this.entityClass);

        for (const key of Object.keys(schema.columns)) {
            const config = schema.columns[key];
            if (!config.generated && !config.isAutoIncrement) continue;

            const currentValue = (doc as any)[key];
            if (currentValue === undefined || currentValue === null || String(currentValue).trim() === '') {

                if (config.generated === 'uuid') {
                    (doc as any)[key] = IdGenerator.generate();
                } else if (config.generated === 'short-id') {
                    (doc as any)[key] = IdGenerator.generateShort();
                } else if (config.isAutoIncrement || config.generated === 'increment') {
                    try {
                        // Traemos todos los registros (incluidos inactivos para no repetir IDs borrados)
                        const allRecords = await this.fetchRawData(true);
                        let maxId = 0;

                        for (const item of allRecords) {
                            const val = parseInt(item[key], 10);
                            if (!isNaN(val) && val > maxId) maxId = val;
                        }
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
    }

    private async processCascadeDelete(doc: SheetDocument<T>): Promise<void> {
        const schema = this.metadataRegistry.getSchema(this.entityClass);
        // Asegúrate de que esto accede al valor correcto en 'doc'
        const parentId = (doc as any)[schema.primaryKey];

        // 1. Obtener la lista de nombres de las relaciones (string[])
        const relationFieldNames = schema.relations;

        for (const relationField of relationFieldNames) {
            // 2. Obtener la configuración real usando el nombre de la relación
            const config = this.metadataRegistry.getRelationOptions(this.entityClass, relationField);

            // Validamos que exista configuración y targetEntity
            if (!config || !config.targetEntity) continue;

            const targetEntityClass = config.targetEntity();

            // 3. Resolvemos propiedades de la configuración
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

            // 4. Continuamos con la lógica de búsqueda y borrado...
            const children = await childRepo.find({ [joinColumn]: parentId } as any);
            const dependentCount = children.length;

            if (dependentCount === 0) continue;

            switch (strategy) {
                case 'RESTRICT':
                    throw new BadRequestException(
                        `Restricción de Integridad: No se puede eliminar el registro en [${this.sheetName}] porque tiene ${dependentCount} registros vinculados en [${childRepo.sheetName}].`
                    );

                case 'SET_NULL':
                    await Promise.all(children.map(child => {
                        const childPk = childRepo.getPrimaryKeyField();
                        return childRepo.findOneAndUpdate(
                            { [childPk]: (child as any)[childPk] } as any,
                            { $set: { [joinColumn]: null } } as any
                        );
                    }));
                    this.logger.log(`🔄 Integridad SET_NULL: [${dependentCount}] hijos desenlazados.`);
                    break;

                case 'CASCADE':
                    const childPk = childRepo.getPrimaryKeyField();
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

    async populate(entity: T, relationField: string): Promise<T> {
        await this.relationManager.populate([entity], this.entityClass);
        return entity;
    }

    private validateWithJoi(data: any): any {
        const details = this.metadataRegistry.getColumnDetails(this.entityClass);
        const joiSchemaMap: Record<string, any> = {};

        Object.keys(details).forEach(prop => {
            const config = details[prop];
            let validator: Joi.Schema;

            if (config.type === Number || config.type === 'number' || config.type === 'currency') {
                validator = Joi.number();
            } else if (config.type === Boolean || config.type === 'boolean') {
                validator = Joi.boolean();
            } else if (config.type === Date || config.type === 'date') {
                validator = Joi.date();
            } else if (config.type === 'array' || Array.isArray(config.type)) {
                validator = Joi.array();
            } else if (config.type === 'json' || typeof config.type === 'object') {
                validator = Joi.any();
            } else {
                validator = Joi.string().allow('');
            }

            joiSchemaMap[prop] = config.required ? validator.required() : validator.optional().allow(null);
        });

        const { error, value } = Joi.object(joiSchemaMap).unknown(true).validate(data, { abortEarly: false });
        if (error) {
            throw new Error(`[Joi Validation Error] en ${this.sheetName}: ${error.message}`);
        }
        return value;
    }

    public async serialize(doc: SheetDocument<T>): Promise<any[]> {
        const headers = await this.getCurrentSheetHeaders();
        return this.dataMapper.toFlatRow(doc.toObject(), this.entityClass, headers);
    }
    async flush(): Promise<void> {
        // 🔥 SOLUCIÓN: Extraer los documentos dirty desde el UnitOfWork
        const allDocs = this.unitOfWork.getAll();
        const dirtyDocs = allDocs.filter((doc: any) => doc.isDirty);

        if (dirtyDocs.length === 0) {
            this.logger.debug(`[Flush] No hay cambios pendientes. Saltando.`);
            return;
        }

        this.logger.debug(`[Flush] Persistiendo ${dirtyDocs.length} documentos...`);

        await Promise.all(dirtyDocs.map(async (doc) => {
            try {
                await doc.save(); // Llama al save() del documento, que a su vez llama a este repositorio
                this.logger.debug(`[Flush] Documento guardado exitosamente.`);
            } catch (error: any) {
                this.logger.error(`[Flush] Error al guardar documento: ${error.message}`);
                throw error;
            }
        }));
    }

    /**
 * 1. Extrae la versión desde el array crudo de Google Sheets.
 * @param rowData - El array de celdas obtenido de la hoja (ej: ["ID-1", "Obrero1", 5])
 * @returns El número de versión actual en la hoja.
 */
    private extractVersionFromRow(rowData: any[]): number {
        const versionField = this.metadataRegistry.getVersionField(this.entityClass);

        // Si no definiste un campo @Version en tu entidad, el bloqueo optimista se deshabilita
        if (!versionField) return 0;

        const columnMap = this.metadataRegistry.getColumnMap(this.entityClass);
        const index = columnMap[versionField];

        if (index === undefined) {
            throw new Error(
                `Error de configuración: La entidad ${this.entityClass.name} tiene un decorador @Version en '${versionField}' ` +
                `pero no está mapeado como una @Column válida.`
            );
        }

        // Retornamos el valor de la celda. Si viene vacío/undefined, asumimos versión 0
        return parseInt(rowData[index] || 0, 10);
    }

    /**
     * 2. Prepara el array ordenado para Google Sheets inyectando la nueva versión.
     * @param dataObject - El objeto plano del documento (toObject()).
     * @param newVersion - El número de versión que se escribirá (version + 1).
     * @returns Array ordenado listo para ser enviado a Google Sheets.
     */
    private prepareDataWithVersion(dataObject: any, newVersion: number): any[] {
        const versionField = this.metadataRegistry.getVersionField(this.entityClass);

        // Obtenemos la lista ordenada de columnas FÍSICAS (ignora virtuales y subcolecciones)
        const orderedColumns = this.metadataRegistry.getColumnList(this.entityClass);

        return orderedColumns.map(columnName => {
            // Si esta es la columna de versión, inyectamos el valor incrementado
            if (columnName === versionField) {
                return newVersion;
            }

            // Obtenemos el valor del objeto. 
            // Usamos null si el valor no existe para mantener la estructura de la fila.
            // Nos aseguramos de acceder a dataObject[columnName]
            return dataObject[columnName] ?? null;
        });
    }

}

