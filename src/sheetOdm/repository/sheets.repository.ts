import { Inject, Injectable, Logger } from '@nestjs/common';
import { GoogleAutenticarService } from '@sheetOdm/services/auth.google.service';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { QueryEngine } from '@sheetOdm/engines/query.engine';
import type { DatabaseModuleOptions } from '@sheetOdm/interfaces/database.options.interface';
import { ClassType, FilterQuery, QueryOptions, UpdateOptions } from '@sheetOdm/types/query.types';
import { NamingStrategy } from '@sheetOdm/strategy/naming.strategy';
import { SHEETS_REPOSITORY_MARKER, SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import { v4 as uuidv4 } from 'uuid';
import * as Joi from 'joi';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';

@Injectable()
export class SheetsRepository<T extends object> {
    private readonly logger = new Logger(SheetsRepository.name);
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

    /**
     * Consulta registros aplicando filtros, ordenamiento, límites y proyecciones.
     */
    async find(filter?: FilterQuery<T>, options?: QueryOptions): Promise<Partial<T>[]> {
        const spreadsheetId = this.optionsDatabase.SPREADSHEET_ID;

        try {
            const response = await this.googleSheets.sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${this.sheetName}!A2:Z10000`, // Traer un rango amplio de registros
            });

            const rows: any[][] = response.data.values || [];
            const details = this.metadataRegistry.getColumnDetails(this.entityClass);
            const columnMap = this.metadataRegistry.getColumnMap(this.entityClass);

            // Mapear cada fila plana en una instancia limpia de la Entidad
            let items: any[] = rows.map((row, index) => {
                const item: any = { __row: index + 2 }; // Fila física real (index 0 es fila 2)

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

            // 1. Filtrar los eliminados lógicamente de forma automática (Soft Delete)
            const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(this.entityClass);
            if (deleteControlProp && !options?.includeInactive) {
                items = items.filter(item => {
                    const isDeleted = item[deleteControlProp];
                    return isDeleted !== true && isDeleted !== 'true' && isDeleted !== 1 && isDeleted !== '1';
                });
            }

            // 2. Ejecutar el motor de consulta en memoria
            return this.queryEngine.execute(items, filter, options);
        } catch (error) {
            this.logger.error(`❌ Error en find() en "${this.sheetName}": ${error.message}`);
            return [];
        }
    }

    /**
     * Obtiene un único registro.
     */
    async findOne(filter?: FilterQuery<T>, projection?: any): Promise<Partial<T> | null> {
        const results = await this.find(filter, { limit: 1, projection });
        return results.length > 0 ? results[0] : null;
    }

    async create1(data: T) {
        console.log('[DEBUG REPO] Clase recibida:', this.entityClass);
        console.log('[DEBUG REPO] Nombre de la clase:', this.entityClass?.name);

        if (!this.entityClass) {
            throw new Error('SheetsRepository: entityClass no está definido en el repositorio.');
        }
        const sheetName = Reflect.getMetadata(SHEETS_TABLE_NAME, this.entityClass);
        const colMap = this.metadataRegistry.getColumnMap(this.entityClass);

        // Convertimos el objeto { nombre: 'Juan' } a un array [ '', 'Juan', ... ]
        // basado en los índices posicionales que define tu Metadata
        const row = new Array(Object.keys(colMap).length).fill('');

        for (const [key, value] of Object.entries(data)) {
            const index = colMap[key];
            if (index !== undefined) row[index] = value;
        }

        // Llamamos al Gateway para insertar
        await this.gateway.appendRow(sheetName, row);
    }

    /**
     * Inserta un nuevo registro en Google Sheets.
     */
    async create(data: Partial<T>): Promise<T> {
        const spreadsheetId = this.optionsDatabase.SPREADSHEET_ID;

        // 1. Generar PK automáticamente si no viene dada
        const pkField = this.getPrimaryKeyField();
        const details = this.metadataRegistry.getColumnDetails(this.entityClass);
        const pkConfig = details[pkField];

        let itemToSave: any = { ...data };

        if (!itemToSave[pkField]) {
            if (pkConfig?.generated === 'uuid') {
                itemToSave[pkField] = uuidv4();
            } else if (pkConfig?.isAutoIncrement || pkConfig?.generated === 'increment') {
                itemToSave[pkField] = await this.calculateNextIncrementId(pkField);
            } else {
                itemToSave[pkField] = uuidv4(); // Fallback por defecto
            }
        }

        // 2. Aplicar validación de Joi dinámica basada en metadatos
        itemToSave = this.validateWithJoi(itemToSave);

        // 3. Serializar objetos complejos (json, array) y mapear a arreglo plano posicional
        const flatRow = this.headers.map(header => {
            const propName = Object.keys(details).find(p => {
                const hName = details[p].name ? details[p].name!.toUpperCase() : NamingStrategy.formatColumnName(p);
                return hName === header;
            });

            if (!propName) return '';
            const rawVal = itemToSave[propName];
            return this.serializeValue(rawVal, details[propName].type);
        });

        try {
            const appendResponse = await this.googleSheets.sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `${this.sheetName}!A:A`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [flatRow],
                },
            });

            // Extraer el índice de la fila física agregada
            const updatedRange = appendResponse.data.updates?.updatedRange || ''; // Ej. OBREROS!A5:C5
            const rowMatch = updatedRange.match(/!A(\d+):/);
            const rowNumber = rowMatch ? parseInt(rowMatch[1], 10) : undefined;

            itemToSave.__row = rowNumber;
            return itemToSave;
        } catch (error) {
            this.logger.error(`❌ Error al crear en "${this.sheetName}": ${error.message}`);
            throw error;
        }
    }

    /**
     * Actualiza un registro existente.
     */
    async update(
        id: string,
        data: Partial<T>,
        options?: { rowNumber?: number }
    ): Promise<T> {
        const spreadsheetId = this.optionsDatabase.SPREADSHEET_ID;
        const pkField = this.getPrimaryKeyField();

        let rowNumber = options?.rowNumber;

        // 1. Si no tenemos la fila física pre-calculada, la localizamos
        if (!rowNumber) {
            const found = await this.findOne({ [pkField]: id } as any);
            if (!found || !(found as any).__row) {
                throw new Error(`Registro con ID "${id}" no encontrado en ${this.sheetName}.`);
            }
            rowNumber = (found as any).__row;
        }

        // 2. Leer estado actual de la fila y fusionar delta
        const response = await this.googleSheets.sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${this.sheetName}!A${rowNumber}:Z${rowNumber}`,
        });

        const currentRow: any[] = response.data.values ? response.data.values[0] : [];
        const details = this.metadataRegistry.getColumnDetails(this.entityClass);

        const currentMergedData: any = {};
        Object.keys(details).forEach(prop => {
            const colConfig = details[prop];
            const headerName = colConfig.name ? colConfig.name.toUpperCase() : NamingStrategy.formatColumnName(prop);
            const colIndex = this.headers.indexOf(headerName);

            if (colIndex !== -1 && currentRow[colIndex] !== undefined) {
                currentMergedData[prop] = this.hydrateValue(currentRow[colIndex], colConfig.type);
            } else {
                currentMergedData[prop] = colConfig.default ?? null;
            }
        });

        // Combinar datos
        const merged = { ...currentMergedData, ...data };
        delete merged.__row;

        // 3. Validar dinámicamente con Joi
        const validated = this.validateWithJoi(merged);

        // 4. Mapear a fila posicional
        const flatRow = this.headers.map(header => {
            const propName = Object.keys(details).find(p => {
                const hName = details[p].name ? details[p].name!.toUpperCase() : NamingStrategy.formatColumnName(p);
                return hName === header;
            });

            if (!propName) return '';
            return this.serializeValue(validated[propName], details[propName].type);
        });

        try {
            await this.googleSheets.sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${this.sheetName}!A${rowNumber}`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [flatRow],
                },
            });

            validated.__row = rowNumber;
            return validated;
        } catch (error) {
            this.logger.error(`❌ Error al actualizar en "${this.sheetName}": ${error.message}`);
            throw error;
        }
    }

    /**
     * Realiza un Soft Delete (marcar borrado lógico) o Hard Delete (limpieza física).
     */
    async delete(id: string): Promise<boolean> {
        const spreadsheetId = this.optionsDatabase.SPREADSHEET_ID;
        const pkField = this.getPrimaryKeyField();

        const found = await this.findOne({ [pkField]: id } as any);
        if (!found || !(found as any).__row) {
            return false;
        }

        const rowNumber = (found as any).__row;
        const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(this.entityClass);

        try {
            if (deleteControlProp) {
                // Soft Delete: Actualizar columna de borrado a true
                const updatePayload: any = { [deleteControlProp]: true };
                await this.update(id, updatePayload, { rowNumber });
                return true;
            } else {
                // Hard Delete: Limpiar los valores de la fila
                await this.googleSheets.sheets.spreadsheets.values.clear({
                    spreadsheetId,
                    range: `${this.sheetName}!A${rowNumber}:Z${rowNumber}`,
                });
                return true;
            }
        } catch (error) {
            this.logger.error(`❌ Error al borrar en "${this.sheetName}": ${error.message}`);
            return false;
        }
    }

    /**
     * Mongoose-Style: Busca un registro y lo actualiza.
     */
    async findOneAndUpdate(
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
    }

    /**
     * Método RECURSIVO: Resuelve relaciones @SubCollection inyectando y consultando otros repositorios.
     */
    async populate(entity: any, relationField: string): Promise<any> {
        if (!entity) return entity;

        const relationConfig = this.metadataRegistry.getRelationOptions(this.entityClass, relationField);
        if (!relationConfig) return entity;

        const targetEntityClass = relationConfig.targetEntity();
        const options = relationConfig.options;

        // Deducir localField y joinColumn
        const localField = options?.localField || this.getPrimaryKeyField();
        const joinColumn = options?.joinColumn || `${this.entityClass.name.toLowerCase()}Id`;

        const parentVal = entity[localField];
        if (parentVal === undefined || parentVal === null) {
            entity[relationField] = [];
            return entity;
        }

        // Obtener dinámicamente el repositorio de la entidad destino
        // Usamos una inyección de respaldo directa a través del Singleton o factory global
        const childRepo = GLOBAL_REPO_REGISTRY.get(targetEntityClass);
        if (!childRepo) {
            this.logger.error(`❌ No se encontró un repositorio registrado para la clase relacionada: [${targetEntityClass.name}]`);
            return entity;
        }

        // Consultar hijos
        const children = await childRepo.find({ [joinColumn]: parentVal });
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

// Registro global auxiliar para resolver inyecciones circulares entre repositorios en populate
export const GLOBAL_REPO_REGISTRY = new Map<any, SheetsRepository<any>>();
