import { Injectable, Logger } from '@nestjs/common';
import { UpdateQuery } from '@sheetOdm/types/query.types';

@Injectable()
export class MutationEngine {
    private readonly logger = new Logger(MutationEngine.name);

    /**
     * Procesa y fusiona un objeto de actualización (con o sin operadores $) 
     * sobre el documento actual.
     * * @param updateQuery El payload de actualización (ej. { $set: { nombre: 'A' }, $inc: { edad: 1 } })
     * @param currentDoc El documento actual extraído de la base de datos/caché
     * @returns Un nuevo objeto con las mutaciones aplicadas (no muta el original por seguridad)
     */
    public mutate<T extends object>(updateQuery: UpdateQuery<T>, currentDoc: Partial<T>): Partial<T> {
        // 1. Trabajamos sobre un clon para evitar efectos secundarios imprevistos en memoria
        const mutatedData = { ...currentDoc };

        // 2. Detectar si la query usa operadores de MongoDB (claves que empiezan con $)
        const hasOperators = Object.keys(updateQuery).some(key => key.startsWith('$'));

        // 3. Flujo Simple: Si no hay operadores, mongoose asume que todo es un gran $set
        if (!hasOperators) {
            return this.applySet(mutatedData, updateQuery as Partial<T>);
        }

        // 4. Flujo Complejo: Aplicar operadores en orden lógico

        if (updateQuery.$set) {
            this.applySet(mutatedData, updateQuery.$set);
        }

        if (updateQuery.$inc) {
            this.applyInc(mutatedData, updateQuery.$inc);
        }

        if (updateQuery.$unset) {
            this.applyUnset(mutatedData, updateQuery.$unset);
        }

        if (updateQuery.$push) {
            this.applyPush(mutatedData, updateQuery.$push);
        }

        if (updateQuery.$pull) {
            this.applyPull(mutatedData, updateQuery.$pull);
        }

        return mutatedData;
    }

    // =========================================================================
    // LÓGICA INTERNA DE OPERADORES
    // =========================================================================

    private applySet<T>(target: any, payload: Partial<T>): any {
        for (const key in payload) {
            if (Object.prototype.hasOwnProperty.call(payload, key)) {
                target[key] = payload[key];
            }
        }
        return target;
    }

    private applyInc<T>(target: any, payload: Record<string, number>): void {
        for (const key in payload) {
            // Aseguramos que ambos valores sean numéricos para evitar concatenación de strings ('1' + 1 = '11')
            const currentVal = Number(target[key] || 0);
            const incValue = Number(payload[key] || 0);

            if (isNaN(currentVal)) {
                this.logger.warn(`Intento de aplicar $inc sobre un campo no numérico: ${key}`);
                continue;
            }

            target[key] = currentVal + incValue;
        }
    }

    private applyUnset<T>(target: any, payload: Record<string, any>): void {
        for (const key in payload) {
            // En MongoDB $unset se usa como { campo: 1 } o { campo: true }
            if (payload[key]) {
                // Para Google Sheets, asignar a null suele ser mejor que eliminar la propiedad,
                // así el serializador sabe que debe sobrescribir la celda con vacío.
                target[key] = null;
            }
        }
    }

    private applyPush<T>(target: any, payload: Record<string, any>): void {
        for (const key in payload) {
            // Si el campo actual está vacío, lo inicializamos como array
            if (!target[key]) {
                target[key] = [];
            }

            // Si no es un array, lo forzamos (resiliencia de datos)
            if (!Array.isArray(target[key])) {
                target[key] = [target[key]];
            }

            target[key].push(payload[key]);
        }
    }

    private applyPull<T>(target: any, payload: Record<string, any>): void {
        for (const key in payload) {
            if (Array.isArray(target[key])) {
                // Filtramos eliminando el elemento exacto
                target[key] = target[key].filter((item: any) => item !== payload[key]);
            }
        }
    }
}