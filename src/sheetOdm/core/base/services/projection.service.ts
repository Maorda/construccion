
import { Injectable } from "@nestjs/common";
import { MetadataRegistry } from "@sheetOdm/services/metadata-registry.service";
import { SheetDataTransformer } from "../sheetDataTransformer";


export type Projection<T = any> = {
    [P in keyof T]?: boolean | number;
} | Record<string, any>

@Injectable()
export class ProjectionService {
    constructor(
        private readonly transformer: SheetDataTransformer,
        private readonly metadataRegistry: MetadataRegistry,
    ) { }

    // Una versión mejorada que entiende rutas con puntos (.)
    // En tu ProjectionService mejorado
    applyProjection(data: any, projection: Projection, entityClass?: any): any {
        if (!projection || Object.keys(projection).length === 0) return data;

        let projectedData: any;

        // 🔥 SOLUCIÓN: Si tenemos la clase, creamos una instancia nueva para preservar getters
        if (entityClass) {
            // Si proyectamos todo (o no hay exclusión), debemos copiar los getters manualmente 
            // si el Object.assign no los toma (a veces los getters no se copian con assign)
            const proto = Object.getPrototypeOf(data);
            Object.getOwnPropertyNames(proto).forEach(prop => {
                const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
                if (descriptor?.get) {
                    // Esto asegura que si el campo está en la proyección, 
                    // o si es una respuesta completa, el getter se mantenga vivo
                    Object.defineProperty(projectedData, prop, descriptor);
                }
            });
        }

        const isInclusion = Object.values(projection).some(v => v === true || v === 1);

        if (isInclusion) {
            // Lógica de Inclusión...
            Object.keys(projection).forEach(path => {
                if (projection[path]) {
                    let value = this.getDeepValue(data, path);

                    // ... (tu lógica de formateo con SheetDataTransformer) ...
                    if (entityClass && value !== undefined) {
                        const colOptions = this.metadataRegistry.getColumnOptions(entityClass, path);
                        if (colOptions?.type) {
                            value = this.transformer.formatValueForSheet(value, colOptions.type);
                        }
                    }

                    if (value !== undefined) {
                        this.setDeepValue(projectedData, path, value);
                    }
                }
            });
        } else {
            // 🔥 Lógica de Exclusión (Shallow Copy sin perder el prototipo)
            // Copiamos las propiedades propias, manteniendo el prototipo intacto
            Object.assign(projectedData, data);

            Object.keys(projection).forEach(path => {
                if (projection[path] === false || projection[path] === 0) {
                    this.deleteDeepValue(projectedData, path);
                }
            });
        }

        return projectedData;
    }

    // 1. OBTENER VALOR: "cuadrilla.obra.nombre" -> data['cuadrilla']['obra']['nombre']
    private getDeepValue(obj: any, path: string): any {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }

    // 2. SETEAR VALOR: Crea la estructura necesaria para asignar el valor
    private setDeepValue(obj: any, path: string, value: any): void {
        const parts = path.split('.');
        const last = parts.pop();
        const deepRef = parts.reduce((acc, part) => {
            if (!acc[part]) acc[part] = {};
            return acc[part];
        }, obj);
        if (last) deepRef[last] = value;
    }

    // 3. ELIMINAR VALOR (El que te faltaba): Borra la propiedad en la ruta profunda
    private deleteDeepValue(obj: any, path: string): void {
        const parts = path.split('.');
        const last = parts.pop();
        // Navegamos hasta el penúltimo nivel
        const deepRef = parts.reduce((acc, part) => acc && acc[part], obj);

        if (deepRef && last && last in deepRef) {
            delete deepRef[last];

            // Opcional: Limpiar objetos padres si quedaron vacíos
            if (Object.keys(deepRef).length === 0 && parts.length > 0) {
                this.deleteDeepValue(obj, parts.join('.'));
            }
        }
    }

    async executePopulate(data: any, path: string): Promise<any> {
        // Aquí irá la lógica para cargar relaciones dinámicamente
        // Ejemplo: si path es 'inspector', buscar en el repo de inspectores
        return data;
    }
}