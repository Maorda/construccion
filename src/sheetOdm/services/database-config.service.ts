// src/config/database-config.service.ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { SHEETS_DTO, SHEETS_REPOSITORY_MARKER } from '@sheetOdm/constants/metadata.constants.js';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway.js';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service.js';
import { ClassType } from '@sheetOdm/types/query.types.js';
import * as crypto from 'crypto';

const SYSTEM_SHEET_NAME = '_ODM_SYSTEM_METADATA_';

@Injectable()
export class DatabaseConfigService implements OnApplicationBootstrap {
    private readonly logger = new Logger(DatabaseConfigService.name);

    constructor(
        private readonly discoveryService: DiscoveryService,
        private readonly gateway: SheetDataGateway,
        private readonly registry: MetadataRegistry,
    ) { }

    async onApplicationBootstrap() {
        if (process.env.NODE_ENV === 'test') {
            this.logger.log('--- 🧪 Entorno de test detectado, saltando sincronización ODM ---');
            return;
        }
        this.logger.log('🚀 Iniciando sincronización inteligente de infraestructura ODM...');
        await this.syncDatabaseSchema();
    }

    private async syncDatabaseSchema() {
        const providers = this.discoveryService.getProviders();
        const sheetRepositories = providers.filter(wrapper =>
            wrapper.instance && wrapper.instance[SHEETS_REPOSITORY_MARKER] === true
        );

        if (sheetRepositories.length === 0) {
            this.logger.warn('⚠️ No se encontraron repositorios de Sheets activos.');
            return;
        }

        try {
            // 1. Cargar las pestañas físicas actuales
            let existingSheets = await this.gateway.getExistingSheetTitles();
            let normalizedExistingSheets = existingSheets.map(s => s.toUpperCase());

            // 2. Cargar o Inicializar la pestaña de Metadatos del Sistema
            const metadataMap = new Map<string, { hash: string, rowIndex: number }>();

            if (!normalizedExistingSheets.includes(SYSTEM_SHEET_NAME)) {
                this.logger.log(`⚙️ Inicializando hoja de sistema: ${SYSTEM_SHEET_NAME}`);
                await this.gateway.createSheet(SYSTEM_SHEET_NAME);
                await this.gateway.writeHeaders(SYSTEM_SHEET_NAME, ['ENTITY_NAME', 'SCHEMA_HASH']);
                normalizedExistingSheets.push(SYSTEM_SHEET_NAME);
            } else {
                // Si ya existe, leemos los hashes de la nube de un solo golpe
                const rows = await this.gateway.getRange(`${SYSTEM_SHEET_NAME}!A2:B`);
                rows.forEach((row, index) => {
                    if (row[0] && row[1]) {
                        metadataMap.set(row[0].toUpperCase(), { hash: String(row[1]), rowIndex: index + 2 });
                    }
                });
            }

            let nextAvailableRow = metadataMap.size + 2; // +1 cabecera, +1 para la siguiente fila libre

            // 3. Iterar los repositorios y sincronizar solo si hay cambios
            for (const wrapper of sheetRepositories) {
                const repository = wrapper.instance;
                const entityClass = (repository as any).entityClass as ClassType<any>;

                if (!entityClass) continue;

                const sheetName = repository.sheetName.toUpperCase();
                const entityName = entityClass.name.toUpperCase();

                // ⚡ Cálculo de la Huella Digital (Hash)
                const currentHash = this.generateSchemaHash(entityClass);
                const savedData = metadataMap.get(entityName);

                // ⚡ VALIDACIÓN INTELIGENTE (Salto si no hay cambios)
                const isSheetMissing = !normalizedExistingSheets.includes(sheetName);
                if (savedData && savedData.hash === currentHash && !isSheetMissing) {
                    this.logger.debug(`🔹 [${entityName}] sin cambios estructurales. Omitiendo sync (Ahorro de API).`);
                    continue;
                }

                // --- INICIO DE SINCRONIZACIÓN FÍSICA ---
                const dto = Reflect.getMetadata(SHEETS_DTO, entityClass);
                if (!dto) throw new Error(`La entidad ${entityClass.name} requiere un DTO en @Table({ dto: ... })`);

                this.validateSchemaConsistency(entityClass, dto);
                const definedHeaders = this.getHeadersForEntity(entityClass);

                if (isSheetMissing) {
                    this.logger.log(`➕ Creando pestaña nueva: "${sheetName}"...`);
                    await this.gateway.createSheet(sheetName);
                    await this.gateway.writeHeaders(sheetName, definedHeaders);
                } else {
                    await this.autoMigrate(sheetName, definedHeaders);
                }

                // --- ACTUALIZAR HASH EN LA NUBE ---
                if (savedData) {
                    // Actualiza fila existente
                    await this.gateway.updateRow(SYSTEM_SHEET_NAME, savedData.rowIndex, [entityName, currentHash]);
                } else {
                    // Inserta fila nueva en el registro de metadatos
                    await this.gateway.updateRow(SYSTEM_SHEET_NAME, nextAvailableRow, [entityName, currentHash]);
                    nextAvailableRow++;
                }
            }

            this.logger.log('✨ Sincronización inteligente completada.');

        } catch (error: any) {
            this.logger.error(`❌ Error crítico de infraestructura ODM: ${error.message}`);
            process.exit(1);
        }
    }

    /**
     * Genera un identificador determinista (Hash MD5) basado en la estructura de la Entidad.
     * Si cambias un nombre de columna, su tipo o su obligatoriedad, el hash cambiará.
     */
    private generateSchemaHash(entityClass: ClassType<any>): string {
        const columnList = this.registry.getColumnList(entityClass);
        const colDetails = this.registry.getColumnDetails(entityClass);

        // Ordenamos las columnas para que el hash sea el mismo aunque las desordenes en el código
        const sortedColumns = [...columnList].sort();

        const schemaDefinition = sortedColumns.map(col => {
            const config = colDetails[col];
            // Normalizamos el tipo a un string para la firma
            const typeStr = typeof config.type === 'function' ? config.type.name : String(config.type);
            const required = config.required ? 'req' : 'opt';
            return `${col}:${typeStr}:${required}`;
        }).join('|');

        return crypto.createHash('md5').update(schemaDefinition).digest('hex');
    }

    private async autoMigrate(sheetName: string, definedHeaders: string[]) {
        const actualRows = await this.gateway.getRange(`${sheetName}!A1:Z1`);
        const currentHeaders = actualRows[0]
            ? (actualRows[0] as string[]).map(h => String(h).trim().toUpperCase())
            : [];

        const missingHeaders = definedHeaders.filter(h => !currentHeaders.includes(h.toUpperCase()));

        if (missingHeaders.length > 0) {
            this.logger.log(`🔄 Migrando "${sheetName}": Añadiendo [${missingHeaders.join(', ')}]`);
            await this.gateway.writeHeaders(sheetName, [...currentHeaders, ...missingHeaders]);
        }
    }

    private validateSchemaConsistency(entity: ClassType<any>, dto: ClassType<any>) {
        const colDetails = this.registry.getColumnDetails(entity);
        const entityFields = Object.keys(colDetails);
        const dtoFields = Object.getOwnPropertyNames(dto.prototype).filter(p => p !== 'constructor');

        for (const field of entityFields) {
            if (!dtoFields.includes(field)) {
                this.logger.warn(`⚠️ Aviso: Campo '${field}' en Entidad no detectado en el DTO.`);
            }
        }
    }

    private getHeadersForEntity(entity: ClassType<any>): string[] {
        const columnList = this.registry.getColumnList(entity);
        const colDetails = this.registry.getColumnDetails(entity);

        return columnList.map(propName => {
            const colConfig = colDetails[propName];
            return (colConfig?.name || propName).toUpperCase();
        });
    }
}