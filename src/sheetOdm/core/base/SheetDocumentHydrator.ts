import { Injectable, Logger } from "@nestjs/common";
import { SheetsRepository } from "@sheetOdm/repository/sheets.repository";
import { ClassType } from "@sheetOdm/types/query.types";
import { SheetDocument } from "@sheetOdm/wrapper/sheet.document1";
import { ROW_INDEX_SYMBOL, SHEETS_COLUMN_DETAILS } from '@sheetOdm/constants/metadata.constants';
import { randomUUID } from "crypto"; // 🔥 Generador nativo de Node.js

export interface HydratorOptions {
    new?: boolean;
    oldDataFlat?: any;
    // 🔥 SOLUCIÓN AL ERROR DE TIPADO: Registramos el constructor dinámico del Modelo
    customConstructor?: ClassType<any>;
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
            const isNewDoc = options.new !== undefined
                ? options.new
                : (dataToProcess[ROW_INDEX_SYMBOL] === undefined);

            // 3. Extraer metadatos de las columnas de la entidad
            const targetPrototype = entityClass.prototype;
            const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, targetPrototype) || {};

            // 4. Instanciar la entidad base
            const instance = new entityClass();
            Object.assign(instance, dataToProcess);

            // 🛡️ BLINDAJE ANTI-PÉRDIDA: Object.assign omite Symbols si no son enumerables. 
            // Forzamos el traspaso manual del puntero de fila física a la instancia base.
            if (dataToProcess[ROW_INDEX_SYMBOL] !== undefined) {
                (instance as any)[ROW_INDEX_SYMBOL] = dataToProcess[ROW_INDEX_SYMBOL];
            }

            // 5. 🔑 AUTO-GENERACIÓN DE UUID
            if (isNewDoc) {
                for (const [propName, config] of Object.entries(details)) {
                    if ((config as any)?.generated === 'uuid' && !instance[propName as keyof typeof instance]) {
                        (instance as any)[propName] = randomUUID();
                    }
                }
            }

            // 6. 🔄 INSTANCIACIÓN VIRTUAL PROTOTÍPICA (Estilo Mongoose)
            // Si viene un constructor personalizado (el Modelo dinámico), lo instanciamos directamente.
            // De lo contrario, cae en el wrapper estándar SheetDocument.
            const TargetConstructor = options.customConstructor || SheetDocument;
            const hydratedDoc = new TargetConstructor(instance as T, repository, isNewDoc) as SheetDocument<T>;

            (hydratedDoc as any)._entityClass = entityClass;

            // Aseguramos que el documento vivo también mantenga el símbolo operacional de la fila
            if ((instance as any)[ROW_INDEX_SYMBOL] !== undefined) {
                (hydratedDoc as any)[ROW_INDEX_SYMBOL] = (instance as any)[ROW_INDEX_SYMBOL];
            }

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
            if (!hydratedDoc || (Object.keys(hydratedDoc).length === 0 && !(hydratedDoc instanceof SheetDocument))) {
                this.logger.error(`[Hydrator] ❌ Error catastrófico: No se pudo generar una instancia válida de SheetDocument.`);
                throw new Error(`Instanciación fallida para la entidad ${entityClass.name}`);
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
            // Log enriquecido para facilitar la depuración en producción
            this.logger.error(`[Hydrator] ❌ Error crítico hidratando la entidad "${entityClass.name}": ${error.message}`);
            throw error;
        }
    }
}