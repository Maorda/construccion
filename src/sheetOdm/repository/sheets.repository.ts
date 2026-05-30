import { Injectable, Logger } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { QueryEngine } from '@sheetOdm/pipelines/query.engine';
import { ClassType, FilterQuery, QueryOptions } from '@sheetOdm/types/query.types';
import { ROW_INDEX_SYMBOL, SHEETS_REPOSITORY_MARKER, SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import * as Joi from 'joi';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { DataMapper } from '@sheetOdm/services/data-mapper.service';
import { RelationManager } from '@sheetOdm/services/relation-manager.service';

import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator';

import { ModuleRef } from '@nestjs/core';
import { getRepositoryToken } from '@sheetOdm/utils/helper';
import { SheetCollection } from '@sheetOdm/wrapper/sheetCollection';
import { SheetDocument } from '@sheetOdm/wrapper/sheetdocument';
// Registro global auxiliar para resolver inyecciones circulares entre repositorios en populate

@Injectable()
export class SheetsRepository<T extends object> {
    readonly logger = new Logger(SheetsRepository.name);
    public readonly [SHEETS_REPOSITORY_MARKER] = true;
    public headers: string[] = [];

    constructor(

        protected readonly metadataRegistry: MetadataRegistry,
        protected readonly queryEngine: QueryEngine<T>,
        public readonly gateway: SheetDataGateway,
        public readonly entityClass: ClassType<T>,
        protected readonly relationManager: RelationManager,
        protected readonly dataMapper: DataMapper,
        private readonly moduleRef: ModuleRef,
        protected readonly hydrator: SheetDocumentHydrator

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

    async find(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<SheetCollection<T>[]> {
        const rawItems = await this.fetchRawData(options?.includeInactive);
        const processedItems = await this.queryEngine.execute(rawItems, filter, options);

        return processedItems
            .map(raw => this.hydrator.hydrateAndShield(this.entityClass, this, raw, {
                new: false,
                customConstructor: (options as any)?.customConstructor // 🔥 Inyección dinámica del Modelo prototípico
            }))
            .filter((doc): doc is SheetCollection<T> => doc !== null);
    }

    async findOne(filter?: FilterQuery<T>, options?: Pick<QueryOptions<T>, 'includeInactive'>): Promise<SheetCollection<T> | null> {
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

    create(data: Partial<T>): SheetCollection<T> {
        const doc = this.hydrator.hydrateAndShield(this.entityClass, this, data, { new: true });
        if (!doc) {
            throw new Error(`[ODM] No se pudo crear el documento virtual para ${this.entityClass.name}`);
        }
        return doc;
    }

    async save(doc: SheetCollection<T>): Promise<SheetCollection<T>> {
        const isNewDocument = (doc as any)._isNew;
        const validatedData = this.validateWithJoi(doc.toObject());

        const headers = await this.getCurrentSheetHeaders();
        const flatRow = this.dataMapper.toFlatRow(validatedData, this.entityClass, headers);

        let assignedRowNumber = doc[ROW_INDEX_SYMBOL];

        if (isNewDocument || !assignedRowNumber) {
            assignedRowNumber = await this.gateway.appendRow(this.sheetName, flatRow);
        } else {
            await this.gateway.updateRow(this.sheetName, assignedRowNumber, flatRow);
        }

        doc.markAsSaved(assignedRowNumber);
        return doc;
    }

    async update(filter: FilterQuery<T>, updateData: Partial<T>): Promise<SheetCollection<T> | null> {
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
    async findOneAndUpdate(
        filter: FilterQuery<T>,
        update: any,
        options?: { upsert?: boolean; new?: boolean; customConstructor?: any }
    ): Promise<SheetCollection<T> | null> {
        const found = await this.findOne(filter, { customConstructor: options?.customConstructor } as any);

        if (!found) {
            if (options?.upsert) {
                const createData = { ...filter, ...(update.$set || update) };
                delete (createData as any).__row;
                const newDoc = this.create(createData);
                return await this.save(newDoc);
            }
            return null;
        }

        const updatePayload = update.$set || update;

        // Soporte nativo para incrementos numéricos continuos
        if (update.$inc) {
            Object.keys(update.$inc).forEach(key => {
                const currentVal = Number(found[key] || 0);
                updatePayload[key] = currentVal + Number(update.$inc[key]);
            });
        }

        Object.assign(found, updatePayload);
        const saved = await this.save(found);

        return options?.new !== false ? saved : found;
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

    private async processCascadeDelete(doc: SheetCollection<T>): Promise<void> {
        const relations = this.metadataRegistry.getRelationsList(this.entityClass);

        for (const relationField of relations) {
            const config = this.metadataRegistry.getRelationOptions(this.entityClass, relationField);

            if (config?.options?.onDelete === 'CASCADE') {
                const targetEntityClass = config.targetEntity();
                const joinColumn = config.options.joinColumn || `${this.entityClass.name.toLowerCase()}Id`;
                const localField = config.options.localField || this.getPrimaryKeyField();
                const parentId = (doc as any)[localField];

                const repoToken = getRepositoryToken(targetEntityClass);
                try {
                    const childRepo = this.moduleRef.get<SheetsRepository<any>>(repoToken, { strict: false });
                    const children = await childRepo.find({ [joinColumn]: parentId } as any);

                    if (children.length > 0) {
                        const childPk = childRepo.getPrimaryKeyField();
                        await Promise.all(
                            children.map(child => childRepo.delete({ [childPk]: (child as any)[childPk] } as any))
                        );
                        this.logger.log(`✅ Cascada concurrente: [${children.length}] hijos removidos en ${targetEntityClass.name}.`);
                    }
                } catch (e) {
                    this.logger.warn(`⚠️ Error en cascada para ${targetEntityClass.name}: ${e.message}`);
                }
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


}

