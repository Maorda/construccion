// @database/engines/sheet-document.hydrator.ts
import { Injectable, Logger } from "@nestjs/common";
import { SheetsRepository } from "@sheetOdm/repository/sheets.repository";
import { ClassType } from "@sheetOdm/types/query.types";
import { SheetDocument } from "@sheetOdm/wrapper/sheet.document";
import { ROW_INDEX_SYMBOL, SHEETS_COLUMN_DETAILS } from '@sheetOdm/constants/metadata.constants';
import { randomUUID } from "crypto"; // 🔥 Generador nativo de Node.js

export interface HydratorOptions {
    new?: boolean;
    oldDataFlat?: any;
}

export interface ISheetDocumentHydrator {
    hydrateAndShield<T extends object>(
        entityClass: ClassType<T>,
        repository: SheetsRepository<T>,
        rawData: any,
        options?: HydratorOptions
    ): SheetDocument<T> | null;
}

@Injectable()
export class SheetDocumentHydrator implements ISheetDocumentHydrator {
    private readonly logger = new Logger(SheetDocumentHydrator.name);

    public hydrateAndShield<T extends object>(
        entityClass: ClassType<T>,
        repository: SheetsRepository<T>,
        rawData: any,
        options: HydratorOptions = {}
    ): SheetDocument<T> | null {
        if (!rawData) return null;

        try {
            // 1. Determinar fuente de datos real
            const dataToProcess = (options.new === false && options.oldDataFlat)
                ? options.oldDataFlat
                : rawData;

            // 2. 🌟 DETECCIÓN DINÁMICA DE NOVEDAD usando el Symbol
            // Si el Symbol es undefined, significa que no tiene fila física, por tanto es nuevo.
            const isNewDoc = options.new !== undefined
                ? options.new
                : (dataToProcess[ROW_INDEX_SYMBOL] === undefined);

            // 3. Extraer metadatos de las columnas de la entidad
            const targetPrototype = entityClass.prototype;
            const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, targetPrototype) || {};

            // 4. Instanciar la entidad base
            const instance = new entityClass();
            Object.assign(instance, dataToProcess);

            // 5. 🔑 AUTO-GENERACIÓN DE UUID
            if (isNewDoc) {
                for (const [propName, config] of Object.entries(details)) {
                    if ((config as any)?.generated === 'uuid' && !instance[propName as keyof typeof instance]) {
                        (instance as any)[propName] = randomUUID();
                    }
                }
            }

            // 6. Instanciar el documento vivo
            const hydratedDoc = new SheetDocument<T>(instance as T, repository, isNewDoc);

            (hydratedDoc as any)._entityClass = entityClass;

            // 7. 📈 VINCULACIÓN DINÁMICA DE VIRTUAL GETTERS
            const descriptors = Object.getOwnPropertyDescriptors(targetPrototype);
            const virtualKeys: string[] = [];

            for (const [key, descriptor] of Object.entries(descriptors)) {
                if (descriptor.get && key !== 'constructor') {
                    virtualKeys.push(key);
                    Object.defineProperty(hydratedDoc, key, {
                        get: descriptor.get.bind(hydratedDoc),
                        enumerable: true,
                        configurable: true
                    });
                }
            }

            // 8. 🛡️ BYPASS TRANSACCIONAL ANTI-VACIADO
            if (!hydratedDoc || Object.keys(hydratedDoc).length === 0) {
                this.logger.warn(`[Hydrator] ⚠️ ¡ALERTA! El documento de [${entityClass.name}] quedó vacío. Aplicando bypass plano.`);
                return dataToProcess as any;
            }

            // 9. 🛡️ SERIALIZADOR TOTAL (Columnas + Virtuals + Control de fila)
            Object.defineProperty(hydratedDoc, 'toJSON', {
                value: function () {
                    const plainObject = {} as any;

                    // Mapear columnas reales
                    const columns = Object.keys(details);
                    for (const col of columns) {
                        plainObject[col] = this[col] !== undefined ? this[col] : null;
                    }

                    // Mapear Virtuals
                    for (const virtualKey of virtualKeys) {
                        plainObject[virtualKey] = this[virtualKey];
                    }

                    // Adjuntar fila física operacional usando el Symbol para lectura, 
                    // pero manteniendo el nombre '__row' en el JSON resultante para compatibilidad.
                    const rowIndex = this[ROW_INDEX_SYMBOL];
                    if (rowIndex !== undefined) {
                        plainObject.__row = rowIndex;
                    }

                    return plainObject;
                },
                enumerable: false,
                configurable: true
            });

            return hydratedDoc;

        } catch (error: any) {
            this.logger.error(`[Hydrator] ❌ Error crítico hidratando documento: ${error.message}`);
            throw error;
        }
    }
}