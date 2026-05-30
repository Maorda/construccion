import { Inject, Injectable, Logger } from '@nestjs/common';
import { GoogleAutenticarService } from '@sheetOdm/services/auth.google.service';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { QueryEngine } from '@sheetOdm/pipelines/query.engine';
import type { DatabaseModuleOptions } from '@sheetOdm/interfaces/database.options.interface';
import { ClassType, FilterQuery, QueryOptions, UpdateOptions } from '@sheetOdm/types/query.types';
import { NamingStrategy } from '@sheetOdm/strategy/naming.strategy';
import { ROW_INDEX_SYMBOL, SHEETS_COLUMN_DETAILS, SHEETS_REPOSITORY_MARKER, SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import { v4 as uuidv4 } from 'uuid';
import * as Joi from 'joi';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { DataMapper } from '@sheetOdm/services/data-mapper.service';
import { RelationManager } from '@sheetOdm/services/relation-manager.service';
import { IdGenerator } from '@sheetOdm/utils/id.generator';
import { SheetDocumentHydrator } from '@sheetOdm/core/base/SheetDocumentHydrator';
import { SheetDocument } from '@sheetOdm/wrapper/sheet.document';
import { ModuleRef } from '@nestjs/core';
import { getRepositoryToken } from '@sheetOdm/utils/helper';
// Registro global auxiliar para resolver inyecciones circulares entre repositorios en populate

@Injectable()
export class SheetsRepository<T extends object> {
    readonly logger = new Logger(SheetsRepository.name);
    public readonly [SHEETS_REPOSITORY_MARKER] = true;

    public sheetName!: string;
    public headers: string[] = [];

    constructor(

        protected readonly googleSheets: GoogleAutenticarService,
        protected readonly metadataRegistry: MetadataRegistry,
        protected readonly queryEngine: QueryEngine,
        @Inject('DATABASE_OPTIONS') protected readonly optionsDatabase: DatabaseModuleOptions,
        protected readonly gateway: SheetDataGateway,
        public readonly entityClass: ClassType<T>,
        protected readonly relationManager: RelationManager,
        protected readonly dataMapper: DataMapper,
        private readonly moduleRef: ModuleRef

    ) {

    }
    /**
     * Inicializa la infraestructura de la pestaña: la crea si no existe y ejecuta auto-migraciones de columnas.
     */
    async initialize(sheetName: string): Promise<void> {
        this.sheetName = sheetName.toUpperCase();
        const spreadsheetId = this.optionsDatabase.SPREADSHEET_ID;

        try {
            // 1. Obtener la metadata actual del documento
            const docInfo = await this.googleSheets.sheets.spreadsheets.get({
                spreadsheetId,
            });

            const sheets = docInfo.data.sheets || [];
            const sheetExists = sheets.some(
                (s: any) => s.properties.title.toUpperCase() === this.sheetName
            );

            const details = this.metadataRegistry.getColumnDetails(this.entityClass);
            const definedHeaders = Object.keys(details).map(prop =>
                details[prop].name ? details[prop].name!.toUpperCase() : NamingStrategy.formatColumnName(prop)
            );

            if (!sheetExists) {
                this.logger.log(`📡 Creando pestaña nueva: "${this.sheetName}"`);
                // Crear pestaña
                await this.googleSheets.sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        requests: [
                            {
                                addSheet: {
                                    properties: { title: this.sheetName },
                                },
                            },
                        ],
                    },
                });

                // Escribir cabeceras iniciales
                await this.googleSheets.sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `${this.sheetName}!A1`,
                    valueInputOption: 'RAW',
                    requestBody: {
                        values: [definedHeaders],
                    },
                });

                this.headers = [...definedHeaders];
                this.logger.log(`✅ Pestaña "${this.sheetName}" creada con cabeceras: [${definedHeaders.join(', ')}]`);
            } else {
                // Leer cabeceras actuales para auto-migración
                const response = await this.googleSheets.sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `${this.sheetName}!A1:Z1`,
                });

                const currentHeaders: string[] = (response.data.values && response.data.values[0])
                    ? response.data.values[0].map((h: string) => h.toUpperCase())
                    : [];

                // Validar si existen columnas nuevas
                const missingHeaders = definedHeaders.filter(h => !currentHeaders.includes(h));

                if (missingHeaders.length > 0) {
                    this.logger.log(`🔄 Auto-migración en "${this.sheetName}": Anexando columnas [${missingHeaders.join(', ')}]`);
                    const finalHeaders = [...currentHeaders, ...missingHeaders];

                    await this.googleSheets.sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `${this.sheetName}!A1`,
                        valueInputOption: 'RAW',
                        requestBody: {
                            values: [finalHeaders],
                        },
                    });
                    this.headers = finalHeaders;
                } else {
                    this.headers = currentHeaders.length > 0 ? currentHeaders : definedHeaders;
                }
            }
        } catch (error) {
            this.logger.error(`❌ Error al inicializar repositorio para ${this.sheetName}: ${error.message}`);
            throw error;
        }
    }



    /**
     * Obtiene el campo físico o mapeado de la llave primaria.
     */
    getPrimaryKeyField(): string {
        return this.metadataRegistry.getPrimaryKeyField(this.entityClass);
    }



    protected async fetchRawData(includeInactive = false): Promise<any[]> {
        const spreadsheetId = this.optionsDatabase.SPREADSHEET_ID;

        // Idealmente, esto debería moverse al this.gateway en el futuro
        const response = await this.googleSheets.sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${this.sheetName}!A2:Z10000`,
        });

        const rows: any[][] = response.data.values || [];
        const details = this.metadataRegistry.getColumnDetails(this.entityClass);

        let items = rows.map((row, index) => {
            const item: any = {};
            item[ROW_INDEX_SYMBOL] = index + 2; // Guardamos la fila física

            Object.keys(details).forEach(prop => {
                const colConfig = details[prop];
                const headerName = colConfig.name ? colConfig.name.toUpperCase() : NamingStrategy.formatColumnName(prop);
                const colIndex = this.headers.indexOf(headerName);

                if (colIndex !== -1 && row[colIndex] !== undefined) {
                    item[prop] = this.hydrateValue(row[colIndex], colConfig.type);
                } else {
                    item[prop] = colConfig.default ?? null;
                }
            });

            return item;
        });

        // Filtrado de eliminación lógica
        const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(this.entityClass);
        if (deleteControlProp && !includeInactive) {
            items = items.filter(item => {
                const isDeleted = item[deleteControlProp];
                return isDeleted !== true && isDeleted !== 'true' && isDeleted !== 1 && isDeleted !== '1';
            });
        }

        return items;
    }

    /**
     * 🔵 BÚSQUEDA TRADICIONAL
     * Devuelve entidades hidratadas (SheetDocument) listas para ser mutadas y guardadas.
     */
    async find(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<SheetDocument<T>[]> {
        try {
            const rawItems = await this.fetchRawData(options?.includeInactive);

            // Pasamos por el pipeline unificado ($match, $sort, $limit)
            const processedItems = await this.queryEngine.execute(rawItems, filter, options);

            // 🌟 LATE HYDRATION: Convertimos SOLO los resultados finales a SheetDocument
            return processedItems.map(raw => new SheetDocument<T>(raw, this, false));
        } catch (error) {
            this.logger.error(`❌ Error en find() en "${this.sheetName}": ${error.message}`);
            return [];
        }
    }

    async findOne(filter?: FilterQuery<T>, options?: Pick<QueryOptions<T>, 'projection' | 'includeInactive'>): Promise<SheetDocument<T> | null> {
        const results = await this.find(filter, { limit: 1, ...options });
        return results.length > 0 ? results[0] : null;
    }

    /**
     * 🟣 MOTOR DE AGREGACIÓN
     * Expone el QueryEngine para operaciones complejas ($group, $lookup, $unwind).
     * Devuelve R[] (datos planos) porque la estructura original muta al agruparse.
     */
    async aggregate<R = any>(pipeline: any[]): Promise<R[]> {
        try {
            const rawItems = await this.fetchRawData(false);
            const result = await this.queryEngine.aggregate(rawItems, pipeline);
            return result as R[];
        } catch (error) {
            this.logger.error(`❌ Error en aggregate() en "${this.sheetName}": ${error.message}`);
            throw error;
        }
    }
    async findAll1(): Promise<T[]> {
        // 1. Obtener datos crudos
        const rawData = await this.gateway.getRange(`${this.sheetName}!A:Z`);

        // 2. Mapear (DataMapper)
        const entities = rawData.slice(1).map(row => this.dataMapper.toEntity(row, this.entityClass));

        // 3. Poblar relaciones (RelationManager)
        return await this.relationManager.populate(entities, this.entityClass);
    }

    /**
     * 🟡 FACTORY: Crea una instancia de SheetDocument en memoria (NO guarda en BD).
     * Útil para instanciar, modificar y luego llamar a doc.save()
     */
    create(data: Partial<T>): SheetDocument<T> {
        const pkField = this.getPrimaryKeyField();
        const details = this.metadataRegistry.getColumnDetails(this.entityClass);
        const pkConfig = details[pkField];

        const itemData: any = { ...data };

        // 1. Generar PK si no existe (Síncrono para UUID/Short-ID)
        if (!itemData[pkField]) {
            if (pkConfig?.generated === 'uuid') {
                itemData[pkField] = IdGenerator.generate();
            } else if (pkConfig?.generated === 'short-id') {
                itemData[pkField] = IdGenerator.generateShort();
            }
        }

        // 2. Instanciación e Hidratación inicial
        return new SheetDocument<T>(itemData, this, true);
    }

    /**
     * 🟠 PERSISTENCIA: Guarda un SheetDocument en Google Sheets (Inserta o Actualiza).
     * Reemplaza a save5() y a la lógica repetida de create().
     */
    async save(doc: SheetDocument<T>): Promise<SheetDocument<T>> {
        const sheetName = Reflect.getMetadata(SHEETS_TABLE_NAME, this.entityClass);
        const isNewDocument = doc.isModified() && (typeof doc.isNew === 'function' ? doc.isNew() : (doc as any)._isNew);

        // 1. Manejo especial para IDs Autoincrementales (Requiere asincronía)
        const pkField = this.getPrimaryKeyField();
        const pkConfig = this.metadataRegistry.getColumnDetails(this.entityClass)[pkField];
        if (isNewDocument && !doc[pkField] && (pkConfig?.isAutoIncrement || pkConfig?.generated === 'increment')) {
            doc[pkField] = await this.calculateNextIncrementId(pkField);
        }

        // 2. Extraer datos planos y validar
        let rawData = doc.toObject();
        rawData = this.validateWithJoi(rawData);

        // 3. Mapeo a fila plana (Array) basado en cabeceras
        const details = this.metadataRegistry.getColumnDetails(this.entityClass);
        const flatRow = this.headers.map(header => {
            const propName = Object.keys(details).find(p => {
                const hName = details[p].name ? details[p].name!.toUpperCase() : NamingStrategy.formatColumnName(p);
                return hName === header;
            });
            if (!propName) return '';
            return this.serializeValue(rawData[propName], details[propName].type);
        });

        try {
            let assignedRowNumber = (doc as any)[ROW_INDEX_SYMBOL];

            if (isNewDocument || !assignedRowNumber) {
                // INSERTAR
                assignedRowNumber = await this.gateway.appendRow(sheetName, flatRow);
            } else {
                // ACTUALIZAR
                await this.gateway.updateRow(sheetName, assignedRowNumber, flatRow);
            }

            // Sellar el documento (limpia el estado de isModified y guarda el nuevo snapshot)
            doc.markAsSaved(assignedRowNumber);
            return doc;

        } catch (error: any) {
            this.logger.error(`❌ [Save] Error en ${sheetName}: ${error.message}`);
            throw error;
        }
    }
    async update(filter: FilterQuery<T>, updateData: Partial<T>): Promise<SheetDocument<T> | null> {
        // 1. Encontrar el documento
        const doc = await this.findOne(filter);
        if (!doc) return null;

        // 2. Fusionar datos (Delta)
        const currentData = doc.toObject();
        const mergedData = { ...currentData, ...updateData };

        // 3. Validar con Joi (esto es vital para mantener la consistencia)
        const validatedData = this.validateWithJoi(mergedData);

        // 4. Aplicar cambios al documento en memoria
        Object.assign(doc, validatedData);

        // 5. Persistir (Usamos el método save() que ya unificamos anteriormente)
        return await this.save(doc);
    }

    async delete(filter: FilterQuery<T>): Promise<boolean> {
        const doc = await this.findOne(filter);
        if (!doc) return false;

        // 1. EJECUTAR CASCADA ANTES DEL BORRADO DEL PADRE
        await this.processCascadeDelete(doc);

        // 2. BORRADO DEL PADRE (Soft o Hard)
        const sheetName = this.sheetName;
        const rowIndex = (doc as any)[ROW_INDEX_SYMBOL];
        const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(this.entityClass);

        try {
            if (deleteControlProp) {
                (doc as any)[deleteControlProp] = true;
                await this.save(doc);
            } else {
                await this.gateway.clearRow(sheetName, rowIndex);
            }
            return true;
        } catch (error) {
            this.logger.error(`❌ [Delete] Error en ${sheetName}: ${error.message}`);
            return false;
        }
    }

    /**
     * Lógica Senior: Resolución dinámica de repositorios para cascada
     */
    private async processCascadeDelete(doc: SheetDocument<T>): Promise<void> {
        const relations = this.metadataRegistry.getRelationsList(this.entityClass); // Debes crear este método en tu Registry

        for (const relationField of relations) {
            const config = this.metadataRegistry.getRelationOptions(this.entityClass, relationField);

            // Solo procesar si es CASCADE
            if (config?.options?.onDelete === 'CASCADE') {
                const targetEntityClass = config.targetEntity();
                const joinColumn = config.options.joinColumn || `${this.entityClass.name.toLowerCase()}Id`;
                const localField = config.options.localField || this.getPrimaryKeyField();
                const parentId = (doc as any)[localField];

                // Resolución dinámica Senior vía ModuleRef
                const repoToken = getRepositoryToken(targetEntityClass);
                try {
                    const childRepo = this.moduleRef.get<SheetsRepository<any>>(repoToken, { strict: false });

                    // Buscar hijos y borrarlos
                    const children = await childRepo.find({ [joinColumn]: parentId } as any);
                    for (const child of children) {
                        await childRepo.delete({ [childRepo.getPrimaryKeyField()]: (child as any)[childRepo.getPrimaryKeyField()] } as any);
                    }
                    this.logger.log(`✅ Cascada ejecutada: [${children.length}] registros de ${targetEntityClass.name} eliminados.`);
                } catch (e) {
                    this.logger.warn(`⚠️ No se pudo ejecutar cascada para ${targetEntityClass.name}: ${e.message}`);
                }
            }
        }
    }

    /**
     * Mongoose-Style: Busca un registro y lo actualiza.
     */
    /*async findOneAndUpdate(
        filter: FilterQuery<T>,
        update: any,
        options?: UpdateOptions
    ): Promise<Partial<T> | null> {
        const found = await this.findOne(filter);
        if (!found) {
            if (options?.upsert) {
                // Intentar crear un registro a partir del filtro y update
                const createData = { ...filter, ...(update.$set || update) };
                delete createData.__row;
                const created = await this.create(createData);
                return created;
            }
            return null;
        }

        const pkField = this.getPrimaryKeyField();
        const id = (found as any)[pkField];
        const rowNumber = (found as any).__row;

        const updatePayload = update.$set || update;
        // Manejar incrementos
        if (update.$inc) {
            Object.keys(update.$inc).forEach(key => {
                const currentVal = Number((found as any)[key] || 0);
                updatePayload[key] = currentVal + Number(update.$inc[key]);
            });
        }

        const updated = await this.update(id, updatePayload, { rowNumber });

        return options?.new !== false ? updated : found;
    }*/

    async populate(entity: any, relationField: string): Promise<any> {
        const config = this.metadataRegistry.getRelationOptions(this.entityClass, relationField);
        if (!config) return entity;

        const targetEntity = config.targetEntity() as ClassType;
        const joinColumn = config.options?.joinColumn || `${this.entityClass.name.toLowerCase()}Id`;
        const localField = config.options?.localField || this.metadataRegistry.getPrimaryKeyField(this.entityClass);

        // Resolución dinámica del repositorio
        const childRepo = this.moduleRef.get<SheetsRepository<any>>(getRepositoryToken(targetEntity), { strict: false });

        const children = await childRepo.find({ [joinColumn]: entity[localField] });
        entity[relationField] = children;

        return entity;
    }

    // --- MÉTODOS AUXILIARES ---

    private hydrateValue(rawVal: string, type: any): any {
        if (rawVal === undefined || rawVal === null || rawVal.trim() === '') {
            return null;
        }

        const cleaned = rawVal.trim();

        if (type === Number || type === 'number' || type === 'currency') {
            return Number(cleaned.replace(/[^0-9.-]/g, ''));
        }

        if (type === Boolean || type === 'boolean') {
            return cleaned === 'true' || cleaned === 'TRUE' || cleaned === '1';
        }

        if (type === Date || type === 'date') {
            return new Date(cleaned);
        }

        if (type === 'json' || type === 'array') {
            try {
                return JSON.parse(cleaned);
            } catch (e) {
                return cleaned;
            }
        }

        return cleaned;
    }

    private serializeValue(val: any, type: any): string {
        if (val === undefined || val === null) {
            return '';
        }

        if (type === 'json' || type === 'array' || typeof val === 'object') {
            return JSON.stringify(val);
        }

        if (val instanceof Date) {
            return val.toISOString();
        }

        return String(val);
    }

    private async calculateNextIncrementId(pkField: string): Promise<number> {
        const results = await this.find({}, { includeInactive: true });
        if (results.length === 0) return 1;

        const ids = results
            .map(item => Number((item as any)[pkField]))
            .filter(id => !isNaN(id));

        return ids.length > 0 ? Math.max(...ids) + 1 : 1;
    }

    private validateWithJoi(data: any): any {
        const details = this.metadataRegistry.getColumnDetails(this.entityClass);
        const joiSchemaMap: Record<string, any> = {};

        Object.keys(details).forEach(prop => {
            const config = details[prop];
            let validator: Joi.Schema;

            // Determinar tipo de validador
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

            if (config.required) {
                validator = validator.required();
            } else {
                validator = validator.optional().allow(null);
            }

            joiSchemaMap[prop] = validator;
        });

        const joiSchema = Joi.object(joiSchemaMap).unknown(true);
        const { error, value } = joiSchema.validate(data, { abortEarly: false });

        if (error) {
            throw new Error(`[Joi Validation Error] en ${this.sheetName}: ${error.message}`);
        }

        return value;
    }
}

