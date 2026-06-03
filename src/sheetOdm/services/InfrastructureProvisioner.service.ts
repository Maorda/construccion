import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { SHEETS_DTO, SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';
import { ClassType } from '@sheetOdm/types/query.types';

@Injectable()
export class InfrastructureProvisioner implements OnApplicationBootstrap {
    private readonly logger = new Logger(InfrastructureProvisioner.name);

    constructor(
        private readonly gateway: SheetDataGateway,
        private readonly registry: MetadataRegistry,
    ) { }

    async onApplicationBootstrap() {
        try {
            await this.syncSchema();
        } catch (error) {
            this.logger.error(`🚨 Fallo crítico en el aprovisionamiento de infraestructura: ${error.message}`);
            throw error; // Bloquea el arranque si la base de datos (Sheets) no es consistente
        }
    }

    async syncSchema() {
        const entities = MetadataRegistry.getAllRegisteredEntities();
        // Traemos los títulos una sola vez para ahorrar cuota de la API de Google
        const existingSheets = await this.gateway.getExistingSheetTitles();
        const existingSheetsUpper = existingSheets.map(s => s.toUpperCase());

        for (const entity of entities) {
            const dto = Reflect.getMetadata(SHEETS_DTO, entity);
            if (!dto) {
                throw new Error(`❌ Error: La entidad ${entity.name} no tiene un DTO vinculado. Define { dto: TuDto } en @Table.`);
            }

            // 1. Validar consistencia estructural código vs tipos
            this.validateSchemaConsistency(entity, dto);

            const sheetName = (Reflect.getMetadata(SHEETS_TABLE_NAME, entity) || entity.name).toUpperCase();
            const definedHeaders = this.getHeadersForEntity(entity);
            const sheetExists = existingSheetsUpper.includes(sheetName);

            if (!sheetExists) {
                await this.provisionNewSheet(sheetName, definedHeaders);
            } else {
                await this.migrateExistingSheet(sheetName, definedHeaders);
            }
        }
    }

    private async provisionNewSheet(sheetName: string, headers: string[]) {
        this.logger.log(`📡 Creando pestaña nueva: "${sheetName}"`);
        await this.gateway.createSheet(sheetName);
        await this.gateway.writeHeaders(sheetName, headers);
        this.logger.log(`✅ Pestaña "${sheetName}" creada con cabeceras: [${headers.join(', ')}]`);
    }

    private async migrateExistingSheet(sheetName: string, definedHeaders: string[]) {
        // 🔥 SOLUCIÓN AL LÍMITE Z1: Leemos la fila 1 completa de manera dinámica
        const actualRows = await this.gateway.getRange(`${sheetName}!1:1`);
        const currentHeaders = actualRows[0]
            ? actualRows[0].map((h: any) => String(h).trim().toUpperCase())
            : [];

        // Detectar columnas faltantes en el Sheet de Google
        const missingHeaders = definedHeaders.filter(h => !currentHeaders.includes(h.toUpperCase()));

        if (missingHeaders.length > 0) {
            this.logger.log(`🔄 Auto-migración en "${sheetName}": Anexando columnas [${missingHeaders.join(', ')}]`);
            const finalHeaders = [...currentHeaders, ...missingHeaders];

            // Sobrescribimos o extendemos la cabecera manteniendo el orden
            await this.gateway.writeHeaders(sheetName, finalHeaders);
            this.logger.log(`✅ Estructura de "${sheetName}" sincronizada con éxito.`);
        }
    }

    private validateSchemaConsistency(entity: ClassType, dto: ClassType) {
        const colDetails = this.registry.getColumnDetails(entity);
        const entityFields = Object.keys(colDetails);

        // 🔥 SOLUCIÓN AL DTO VACÍO: Instanciamos y evaluamos prototipos y metadatos
        const dtoInstance = new (dto as any)();

        // Combinamos propiedades físicas inicializadas + las que existan en el prototipo
        const dtoFields = new Set([
            ...Object.getOwnPropertyNames(dtoInstance),
            ...Object.getOwnPropertyNames(dto.prototype)
        ]);

        for (const field of entityFields) {
            // Ignoramos el constructor del prototipo si se cuela
            if (field === 'constructor') continue;

            // Si no hay campos inicializados en JS, usamos la validación basada en reflection
            const dtoFieldType = Reflect.getMetadata('design:type', dto.prototype, field);

            // Si no está en las propiedades y tampoco tiene tipo metadata, el DTO no lo mapea
            if (!dtoFields.has(field) && !dtoFieldType) {
                throw new Error(
                    `❌ [ODM Error] La entidad '${entity.name}' define la columna '${field}', ` +
                    `pero no existe o no está inicializada en el DTO '${dto.name}'.`
                );
            }

            const entityColumnType = colDetails[field].type;

            if (entityColumnType && dtoFieldType) {
                const dtoTypeName = dtoFieldType.name.toLowerCase();
                if (entityColumnType !== dtoTypeName) {
                    throw new Error(
                        `❌ [ODM Error] Inconsistencia en '${field}'. DTO '${dto.name}' espera tipo '${dtoTypeName}', pero la Entidad define '${entityColumnType}'.`
                    );
                }
            }
        }
    }

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