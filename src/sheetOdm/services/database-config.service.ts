import { Injectable, OnModuleInit, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

import { NamingStrategy } from '@sheetOdm/strategy/naming.strategy';
import { SHEETS_DTO, SHEETS_REPOSITORY_MARKER, SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { MetadataRegistry } from './metadata-registry.service';
import { ClassType } from '@sheetOdm/types/query.types';

@Injectable()
export class DatabaseConfigService implements OnApplicationBootstrap {
    private readonly logger = new Logger(DatabaseConfigService.name);

    constructor(
        private readonly discoveryService: DiscoveryService,
        private readonly gateway: SheetDataGateway,
        private readonly registry: MetadataRegistry,
    ) { }

    async onApplicationBootstrap() {
        this.logger.log('🚀 Iniciando sincronización de infraestructura del ODM con Google Sheets...');
        await this.syncDatabaseSchema();
    }

    private async syncDatabaseSchema() {
        // 1. Descubrir todos los providers instanciados en el ecosistema NestJS
        const providers = this.discoveryService.getProviders();

        // 2. Filtrar los que tengan la marca de agua de nuestros Repositorios
        const sheetRepositories = providers.filter(wrapper =>
            wrapper.instance && wrapper.instance[SHEETS_REPOSITORY_MARKER] === true
        );

        if (sheetRepositories.length === 0) {
            this.logger.warn('⚠️ No se encontraron repositorios de Sheets activos en la aplicación.');
            return;
        }

        try {
            // 3. Traer de un solo golpe todas las pestañas reales que existen en el Excel
            const existingSheets = await this.gateway.getExistingSheetTitles();
            const normalizedExistingSheets = existingSheets.map(s => s.toUpperCase());

            for (const wrapper of sheetRepositories) {
                const repository = wrapper.instance;
                const entityClass = (repository as any).entityClass as ClassType;

                if (!entityClass) {
                    this.logger.warn(`⚠️ Repositorio [${wrapper.name}] ignorado: Falta la referencia 'entityClass'.`);
                    continue;
                }

                // 🎯 El repositorio ya calcula su propio sheetName limpiamente mediante Getters
                const sheetName = repository.sheetName;
                this.logger.log(`📡 Inspeccionando entidad: [${entityClass.name}] asignada a la pestaña "${sheetName}"`);

                // 4. Validar consistencia del DTO obligatorio
                const dto = Reflect.getMetadata(SHEETS_DTO, entityClass);
                if (!dto) {
                    throw new Error(`La entidad ${entityClass.name} no tiene un DTO vinculado en @Table({ dto: ... })`);
                }
                this.validateSchemaConsistency(entityClass, dto);

                // 5. Obtener las cabeceras teóricas declaradas por los decoradores @Column
                const definedHeaders = this.getHeadersForEntity(entityClass);
                const sheetExists = normalizedExistingSheets.includes(sheetName.toUpperCase());

                if (!sheetExists) {
                    // --- CASO A: LA PESTAÑA NO EXISTE EN DRIVE ---
                    this.logger.log(`➕ Creando pestaña nueva: "${sheetName}"...`);
                    await this.gateway.createSheet(sheetName);

                    // Escribir las cabeceras iniciales
                    await this.gateway.writeHeaders(sheetName, definedHeaders);
                    this.logger.log(`✅ Pestaña "${sheetName}" creada con éxito con cabeceras: [${definedHeaders.join(', ')}]`);
                } else {
                    // --- CASO B: LA PESTAÑA EXISTE -> EVALUAR AUTO-MIGRACIÓN ---
                    const actualRows = await this.gateway.getRange(`${sheetName}!A1:Z1`);
                    const currentHeaders = actualRows[0]
                        ? actualRows[0].map((h: any) => String(h).trim().toUpperCase())
                        : [];

                    // Buscar si el desarrollador agregó propiedades nuevas al código de la Entidad
                    const missingHeaders = definedHeaders.filter(h => !currentHeaders.includes(h.toUpperCase()));

                    if (missingHeaders.length > 0) {
                        this.logger.log(`🔄 Auto-migración detectada en "${sheetName}": Añadiendo columnas faltantes [${missingHeaders.join(', ')}]`);
                        const finalHeaders = [...currentHeaders, ...missingHeaders];

                        // Reescribimos la fila de cabeceras expandiéndola de forma segura
                        await this.gateway.writeHeaders(sheetName, finalHeaders);
                        this.logger.log(`✅ Estructura de "${sheetName}" actualizada y sincronizada.`);
                    } else {
                        this.logger.log(`🔹 Estructura de "${sheetName}" al día. No requiere cambios.`);
                    }
                }
            }

            this.logger.log('✨ Sincronización completa. Todos los repositorios se encuentran operativos.');

        } catch (error: any) {
            this.logger.error(`❌ Error crítico de infraestructura ODM: ${error.message}`);
            // Si la base de datos documental (Sheets) está corrupta o inaccesible, abortamos el arranque del API.
            process.exit(1);
        }
    }

    /**
     * Valida que el DTO y los Decoradores de la Entidad coincidan perfectamente en propiedades y tipos
     */
    private validateSchemaConsistency(entity: ClassType, dto: ClassType) {
        const colDetails = this.registry.getColumnDetails(entity);
        const dtoInstance = new (dto as any)();
        const dtoFields = Object.getOwnPropertyNames(dtoInstance);
        const entityFields = Object.keys(colDetails);

        for (const field of entityFields) {
            if (!dtoFields.includes(field)) {
                throw new Error(`[ODM Error] La entidad '${entity.name}' define '${field}', pero no existe en su DTO '${dto.name}'.`);
            }
            const dtoFieldType = Reflect.getMetadata('design:type', dto.prototype, field);
            const entityColumnType = colDetails[field].type;

            if (entityColumnType && dtoFieldType) {
                const dtoTypeName = dtoFieldType.name.toLowerCase();
                if (entityColumnType !== dtoTypeName) {
                    throw new Error(`[ODM Error] Inconsistencia de tipo en '${field}'. DTO espera '${dtoTypeName}', Entidad define '${entityColumnType}'.`);
                }
            }
        }
    }

    /**
     * Transforma los metadatos de las columnas en un array ordenado de cabeceras físicas para Google Sheets
     */
    private getHeadersForEntity(entity: ClassType): string[] {
        const colDetails = this.registry.getColumnDetails(entity);
        const colMap = this.registry.getColumnMap(entity);
        return Object.entries(colMap)
            .sort(([, a], [, b]) => a - b)
            .map(([propName]) => {
                const colConfig = colDetails[propName];
                return (colConfig?.name ? colConfig.name : propName).toUpperCase();
            });
    }
}
