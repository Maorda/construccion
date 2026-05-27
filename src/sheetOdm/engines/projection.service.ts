import { Injectable } from '@nestjs/common';
import { Projection } from '@sheetOdm/types/query.types';

@Injectable()
export class ProjectionService {
    /**
     * Aplica una proyección sobre una entidad para retornar solo los campos solicitados.
     */
    project<T extends object>(item: T, projection?: Projection<T>): Partial<T> {
        if (!projection || Object.keys(projection).length === 0) {
            return item;
        }

        const keys = Object.keys(projection);
        const firstValue = projection[keys[0]];

        // Determinar si es inclusión (1 o true) o exclusión (0 o false)
        // Mongoose no permite mezclar inclusión y exclusión excepto para _id
        const isInclusion = firstValue === 1 || firstValue === true;

        const result: any = {};

        if (isInclusion) {
            // Incluir solo los campos seleccionados
            for (const key of keys) {
                if (projection[key] === 1 || projection[key] === true) {
                    result[key] = (item as any)[key];
                }
            }
            // Mongoose por defecto mantiene la PK a menos que sea explícitamente omitida
            // Para simplicidad, si la PK (ej: 'id') no está en la proyección, no la forzamos a menos que no haya nada.
        } else {
            // Copiar todos los campos EXCEPTO los excluidos
            const itemKeys = Object.keys(item);
            for (const key of itemKeys) {
                if (projection[key] !== 0 && projection[key] !== false) {
                    result[key] = (item as any)[key];
                }
            }
        }

        return result;
    }
}
