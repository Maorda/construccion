import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { SHEETS_DTO, SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import { SheetDataGateway } from '@sheetOdm/gateway/sheetDataGateway';


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
            // --- 1. CAPA DE VALIDACIÓN (NUEVO) ---
            const dto = Reflect.getMetadata(SHEETS_DTO, entity);
            if (!dto) {
                throw new Error(`❌ Error: La entidad ${entity.name} no tiene un DTO vinculado. Por favor, define { dto: TuDto } en @Table.`);
            }

            // Ejecutamos la validación de consistencia antes de tocar cualquier sheet
            this.validateSchemaConsistency(entity, dto);

            // --- 2. LÓGICA EXISTENTE ---
            const sheetName = Reflect.getMetadata(SHEETS_TABLE_NAME, entity);

            if (!existingSheets.includes(sheetName)) {
                await this.gateway.createSheet(sheetName);
            }

            // Provisionamos cabeceras usando el Gateway
            const headers = this.getHeadersForEntity(entity);
            await this.gateway.writeHeaders(sheetName, headers);
        }
    }

    private validateSchemaConsistency(entity: Function, dto: Function) {
        const colDetails = this.registry.getColumnDetails(entity);
        const dtoInstance = new (dto as any)();
        const dtoFields = Object.getOwnPropertyNames(dtoInstance);
        const entityFields = Object.keys(colDetails);

        for (const field of entityFields) {
            if (!dtoFields.includes(field)) {
                throw new Error(
                    `❌ [ODM Error] La entidad '${entity.name}' define la columna '${field}', ` +
                    `pero no existe en el DTO '${dto.name}'. Asegúrate de exponer todos los campos necesarios.`
                );
            }
            // 1. Error crítico: Propiedad en DTO sin mapeo en Entidad
            if (!colDetails[field]) {
                throw new Error(
                    `❌ [ODM Error] La propiedad '${field}' existe en el DTO '${dto.name}' ` +
                    `pero no está mapeada con @Column en la entidad '${entity.name}'. ` +
                    `Debes añadir @Column en la entidad para permitir este campo.`
                );
            }

            // 2. Error crítico: Mismatch de tipos
            const dtoFieldType = Reflect.getMetadata('design:type', dto.prototype, field);
            const entityColumnType = colDetails[field].type;

            if (entityColumnType && dtoFieldType) {
                const dtoTypeName = dtoFieldType.name.toLowerCase();
                if (entityColumnType !== dtoTypeName) {
                    throw new Error(
                        `❌ [ODM Error] Inconsistencia de tipo en '${field}'. ` +
                        `El DTO espera '${dtoTypeName}', pero la entidad '${entity.name}' ` +
                        `lo tiene definido como '${entityColumnType}'.`
                    );
                }
            }
        }
    }

    private getHeadersForEntity(entity: Function): string[] {
        const colDetails = this.registry.getColumnDetails(entity);
        const colMap = this.registry.getColumnMap(entity);
        return Object.entries(colMap)
            .sort(([, a], [, b]) => a - b)
            .map(([propName]) => colDetails[propName].name || propName);
    }
}