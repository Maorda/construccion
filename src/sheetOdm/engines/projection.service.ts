import { Injectable, Logger } from '@nestjs/common';
import { ClassType, Projection } from '@sheetOdm/types/query.types.js';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service.js';


@Injectable()
export class ProjectionService {
    private readonly logger = new Logger(ProjectionService.name);
    constructor(private readonly metadataRegistry: MetadataRegistry) { }
    /**
     * Aplica la proyección solicitada filtrando campos físicos o calculando propiedades virtuales.
     */
    public project<T extends object>(
        item: T | T[],
        entityClass: ClassType<T>,
        projection?: Projection<T>
    ): Partial<T> | Partial<T>[] {

        // Gestión eficiente de colecciones
        if (Array.isArray(item)) {
            return item.map(i => this.project(i, entityClass, projection) as Partial<T>);
        }

        // 1. Short-circuit: Si no hay criterios de proyección, devolvemos el objeto íntegro
        if (!projection || Object.keys(projection).length === 0) {
            return typeof (item as any).toJSON === 'function' ? (item as any).toJSON() : item;
        }

        const result: any = {};

        // 2. Extraer toda la estructura unificada desde el Caché del Registro
        const schema = this.metadataRegistry.getSchema(entityClass);
        const columnDetails = schema.columns;
        const virtuals = schema.virtuals;

        // 3. Procesar los campos solicitados en la proyección (Optimizado con Object.keys)
        const projectionKeys = Object.keys(projection);

        for (const key of projectionKeys) {
            const value = projection[key as keyof Projection<T>];

            // CASO A: Es un Campo Físico de Google Sheets
            if (columnDetails[key]) {
                if (value) {
                    result[key] = (item as any)[key];
                }
            }

            // CASO B: Es un Grupo de Propiedades Virtuales (@VirtualProperty)
            else if (virtuals.some((v: any) => v.group === key)) {
                const groupName = key;
                const requestedFields = value;
                const virtualsInGroup = virtuals.filter((v: any) => v.group === groupName);

                if (virtualsInGroup.length > 0) {
                    result[groupName] = result[groupName] || {};

                    for (const v of virtualsInGroup) {
                        let shouldProject = false;

                        // Evaluar estrategia de selección del campo virtual
                        if (requestedFields === true) {
                            shouldProject = true;
                        } else if (Array.isArray(requestedFields)) {
                            shouldProject = requestedFields.includes(v.propertyKey);
                        } else if (typeof requestedFields === 'object' && requestedFields !== null) {
                            shouldProject = (requestedFields as any)[v.propertyKey] === true;
                        }

                        if (shouldProject) {
                            let val = (item as any)[v.propertyKey];

                            // Invocación segura JIT del Getter en caso de deshidratación
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

                            // Sanitización final para salidas JSON consistentes
                            result[groupName][v.propertyKey] = (val === undefined || (typeof val === 'number' && isNaN(val)))
                                ? null
                                : val;
                        }
                    }
                }
            }
            else {
                this.logger.warn(`Proyección ignorada: '${key}' no es un campo ni un grupo válido en la entidad ${entityClass.name}`);
            }
        }

        return result;
    }

}
