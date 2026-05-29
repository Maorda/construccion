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
        item: T | T[],
        entityClass: ClassType<T>,
        projection?: Projection<T>
    ): Partial<T> | Partial<T>[] {

        // Si es un arreglo, mapeamos cada elemento individualmente
        if (Array.isArray(item)) {
            return item.map(i => this.project(i, entityClass, projection) as Partial<T>);
        }

        // 1. Si no hay proyección, retornamos el objeto serializado completo
        if (!projection || Object.keys(projection).length === 0) {
            return typeof (item as any).toJSON === 'function' ? (item as any).toJSON() : item;
        }

        const result: any = {};

        // 2. Extraer metadatos
        const columnDetails = this.metadataRegistry.getColumnDetails(entityClass) || {};
        const virtuals = Reflect.getMetadata(SHEETS_VIRTUAL_COLUMNS, entityClass) || [];

        // 3. Procesar proyección
        for (const key in projection) {
            const value = projection[key as keyof Projection<T>];

            // A. Caso: Campo Físico (definido en @Column)
            if (columnDetails[key]) {
                if (value) result[key] = (item as any)[key];
            }

            // B. Caso: Grupo de campos virtuales (ej: 'calculos')
            else if (virtuals.some((v: any) => v.group === key)) {
                const groupName = key;
                const requestedFields = value;
                const virtualsInGroup = virtuals.filter((v: any) => v.group === groupName);

                if (virtualsInGroup.length > 0) {
                    result[groupName] = {};

                    for (const v of virtualsInGroup) {
                        let shouldProject = false;

                        // Evaluar si el campo específico fue solicitado
                        if (requestedFields === true) {
                            shouldProject = true;
                        }
                        else if (Array.isArray(requestedFields)) {
                            shouldProject = requestedFields.includes(v.propertyKey);
                        }
                        else if (typeof requestedFields === 'object' && requestedFields !== null) {
                            shouldProject = (requestedFields as any)[v.propertyKey] === true;
                        }

                        if (shouldProject) {
                            // 1. Intentar leer directo (si mantiene la instancia viva)
                            let val = (item as any)[v.propertyKey];

                            // 2. Extracción dinámica: Si es undefined, forzamos la invocación del getter
                            // apuntando el 'this' al payload de datos actual.
                            if (val === undefined) {
                                const proto = entityClass.prototype;
                                const descriptor = Object.getOwnPropertyDescriptor(proto, v.propertyKey);

                                if (descriptor && typeof descriptor.get === 'function') {
                                    try {
                                        val = descriptor.get.call(item);
                                    } catch (err) {
                                        this.logger.error(`Error al ejecutar el getter virtual '${v.propertyKey}': ${err.message}`);
                                        val = null;
                                    }
                                }
                            }

                            // 3. Control de serialización: Si el valor es undefined o NaN, asignamos null
                            // para asegurar que la propiedad se mantenga visible en la respuesta JSON.
                            if (val === undefined || (typeof val === 'number' && isNaN(val))) {
                                result[groupName][v.propertyKey] = null;
                            } else {
                                result[groupName][v.propertyKey] = val;
                            }
                        }
                    }
                }
            }
            else {
                this.logger.warn(`Proyección ignorada: '${key}' no es un campo ni un grupo válido en ${entityClass.name}`);
            }
        }

        return result;
    }

}
