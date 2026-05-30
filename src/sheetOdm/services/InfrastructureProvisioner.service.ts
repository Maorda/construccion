import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
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
        await this.syncSchema();
    }
    async syncSchema() {
        const entities = MetadataRegistry.getAllRegisteredEntities();
        const existingSheets = await this.gateway.getExistingSheetTitles();

        for (const entity of entities) {
            // --- 1. CAPA DE VALIDACIÓN DTO vs ENTIDAD ---
            const dto = Reflect.getMetadata(SHEETS_DTO, entity);
            if (!dto) {
                throw new Error(`❌ Error: La entidad ${entity.name} no tiene un DTO vinculado. Por favor, define { dto: TuDto } en @Table.`);
            }

            this.validateSchemaConsistency(entity, dto);

            // --- 2. CONTROL DE INFRAESTRUCTURA PURA VÍA GATEWAY ---
            const sheetName = (Reflect.getMetadata(SHEETS_TABLE_NAME, entity) || entity.name).toUpperCase();
            const definedHeaders = this.getHeadersForEntity(entity);

            const sheetExists = existingSheets.map(s => s.toUpperCase()).includes(sheetName);

            if (!sheetExists) {
                this.logger.log(`📡 Creando pestaña nueva: "${sheetName}"`);
                await this.gateway.createSheet(sheetName);

                // Escribir cabeceras usando el método nativo del Gateway
                await this.gateway.writeHeaders(sheetName, definedHeaders);
                this.logger.log(`✅ Pestaña "${sheetName}" creada con cabeceras: [${definedHeaders.join(', ')}]`);
            } else {
                // Leer la primera fila de manera segura usando la abstracción del Gateway
                const actualRows = await this.gateway.getRange(`${sheetName}!A1:Z1`);
                const currentHeaders = actualRows[0]
                    ? actualRows[0].map((h: any) => String(h).trim().toUpperCase())
                    : [];

                // Detectar si el programador añadió nuevas columnas en el código de la Entidad
                const missingHeaders = definedHeaders.filter(h => !currentHeaders.includes(h.toUpperCase()));

                if (missingHeaders.length > 0) {
                    this.logger.log(`🔄 Auto-migración en "${sheetName}": Anexando columnas detectadas [${missingHeaders.join(', ')}]`);
                    const finalHeaders = [...currentHeaders, ...missingHeaders];

                    // Reutilizamos writeHeaders del Gateway para actualizar la fila A1 con el nuevo Layout extendido
                    await this.gateway.writeHeaders(sheetName, finalHeaders);
                    this.logger.log(`✅ Estructura de "${sheetName}" sincronizada con éxito.`);
                }
            }
        }
    }

    private validateSchemaConsistency(entity: ClassType, dto: ClassType) {
        const colDetails = this.registry.getColumnDetails(entity);
        const dtoInstance = new (dto as any)();
        const dtoFields = Object.getOwnPropertyNames(dtoInstance);
        const entityFields = Object.keys(colDetails);

        for (const field of entityFields) {
            if (!dtoFields.includes(field)) {
                throw new Error(
                    `❌ [ODM Error] La entidad '${entity.name}' define la columna '${field}', ` +
                    `pero no existe en el DTO '${dto.name}'.`
                );
            }
            if (!colDetails[field]) {
                throw new Error(
                    `❌ [ODM Error] La propiedad '${field}' existe en el DTO '${dto.name}' pero no tiene @Column.`
                );
            }

            const dtoFieldType = Reflect.getMetadata('design:type', dto.prototype, field);
            const entityColumnType = colDetails[field].type;

            if (entityColumnType && dtoFieldType) {
                const dtoTypeName = dtoFieldType.name.toLowerCase();
                if (entityColumnType !== dtoTypeName) {
                    throw new Error(
                        `❌ [ODM Error] Inconsistencia en '${field}'. DTO espera '${dtoTypeName}', Entidad define '${entityColumnType}'.`
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