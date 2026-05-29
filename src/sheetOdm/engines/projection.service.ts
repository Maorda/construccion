import { Injectable, Logger } from '@nestjs/common';
import { ClassType, Projection } from '@sheetOdm/types/query.types';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { SHEETS_VIRTUAL_COLUMNS } from '@sheetOdm/constants/metadata.constants';

@Injectable()
export class ProjectionService {
    private readonly logger = new Logger(ProjectionService.name);
    constructor(private readonly metadataRegistry: MetadataRegistry) { }
    /**
     * Aplica proyección usando tus tipos definidos para máxima seguridad.
     */
    project<T extends object>(
        item: T,
        entityClass: ClassType<T>,
        projection?: Projection<T>
    ): Partial<T> {

        // 1. Si no hay proyección, retornamos el objeto serializado completo
        if (!projection || Object.keys(projection).length === 0) {
            return (item as any).toJSON();
        }

        const result: any = {};

        // 2. Extraer metadatos
        const columnDetails = this.metadataRegistry.getColumnDetails(entityClass);
        const virtuals = Reflect.getMetadata(SHEETS_VIRTUAL_COLUMNS, entityClass) || [];

        // 3. Procesar proyección de forma tipada
        for (const key in projection) {
            const value = projection[key];

            // A. Caso: Campo Físico (definido en @Column)
            if (columnDetails[key]) {
                if (value) result[key] = (item as any)[key];
            }

            // B. Caso: Grupo de campos virtuales (ej: 'calculos')
            // Usamos Record<string, any> para iterar sobre el objeto anidado
            else if (typeof value === 'object' && value !== null) {
                const groupName = key;
                const groupProjections = value as Record<string, any>;

                // Filtramos los campos virtuales que pertenecen a este grupo específico
                const virtualsInGroup = virtuals.filter((v: any) => v.group === groupName);

                result[groupName] = {};
                for (const v of virtualsInGroup) {
                    // Si el usuario pidió este campo virtual específico dentro del grupo
                    if (groupProjections[v.propertyKey]) {
                        result[groupName][v.propertyKey] = (item as any)[v.propertyKey];
                    }
                }
            }

            // C. Warning si el campo no existe en ninguno de los dos mundos
            else {
                this.logger.warn(`Proyección ignorada: '${key}' no es un campo ni un grupo válido en ${entityClass.name}`);
            }
        }

        return result;
    }
}
