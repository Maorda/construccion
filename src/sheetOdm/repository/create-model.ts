import { SHEETS_COLUMN_DETAILS, SHEETS_COLUMN_LIST } from '@sheetOdm/constants/metadata.constants';
import { ROW_INDEX_SYMBOL } from '@sheetOdm/constants/metadata.constants'; // <-- Importación necesaria
import { SheetsRepository } from './sheets.repository';
import { ClassType, FilterQuery } from '@sheetOdm/types/query.types';
import { deepClone, SheetDocument } from '@sheetOdm/wrapper/sheet.document';
import { Inject, Logger } from '@nestjs/common';

export const InjectModel = (entity: Function) => Inject(`${entity.name}Model`);

export type Model<T extends object> = {
    // Constructor para instancias (Active Record)
    new(data?: Partial<T>): T & SheetDocument<T>;

    // Métodos estáticos (Query Engine)
    save(data: Partial<T>): Promise<T & SheetDocument<T>>;
    find(filter?: FilterQuery<T>, options?: any): Promise<Partial<T>[]>;
    // findOne(filter?: FilterQuery<T>, projection?: any): Promise<Partial<T> | null>;
    //findOneAndUpdate(filter: FilterQuery<T>, update: any, options?: any): Promise<Partial<T> | null>;
};

export function createModel<T extends object>(
    entityClass: ClassType<T>,
    repo: SheetsRepository<T>
): Model<T> {
    const ModelClass = class extends SheetDocument<T> {
        constructor(data?: Partial<T>) {
            // 1. Pasamos un objeto vacío inicial seguro al padre
            super({} as T, repo, false);

            // 2. INYECCIÓN CRÍTICA DE CONTEXTO
            (this as any)._entityClass = entityClass;

            // 3. HIDRATACIÓN DIRECTA DE LA INSTANCIA
            if (data) {
                Object.assign(this, data);
            }

            // 4. ESTABILIZACIÓN DEL ESTADO DE NUEVO (Refactorizado)
            // Usamos el Symbol para verificar si el objeto tiene una fila física asignada
            this._isNew = !data || (data as any)[ROW_INDEX_SYMBOL] === undefined;

            // 5. BLINDAJE DEL SNAPSHOT
            try {
                const plainData = typeof this.toObject === 'function' ? this.toObject() : (data ? deepClone(data) : {});
                (this as any)._snapshot = deepClone(plainData);
            } catch (e) {
                (this as any)._snapshot = data ? deepClone(data) : ({} as T);
            }
        }

        // --- MÉTODOS DE INSTANCIA (Active Record) ---
        async save(): Promise<this> {
            try {
                if (!this.isModified()) {
                    return this;
                }
            } catch (error) {
                const logger = new Logger('ModelFactory-Fallback');
                logger.warn(`[Factory] Error analizando deltas (isModified). Forzando persistencia directa.`);
            }

            await super.save();
            return this;
        }
    };

    // ⚡ PUENTE DE METADATOS VITAL:
    const entityMetadata = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, entityClass.prototype);
    if (entityMetadata) {
        Reflect.defineMetadata(SHEETS_COLUMN_DETAILS, entityMetadata, ModelClass.prototype);
    }

    const columnList = Reflect.getMetadata(SHEETS_COLUMN_LIST, entityClass.prototype);
    if (columnList) {
        Reflect.defineMetadata(SHEETS_COLUMN_LIST, columnList, ModelClass.prototype);
    }

    // --- MÉTODOS ESTÁTICOS ---
    (ModelClass as any).find = (filter: FilterQuery<T>, options?: any) =>
        repo.find(filter, options);

    // 2. Vinculamos FIND ONE (Necesario)
    /* (ModelClass as any).findOne = (filter: FilterQuery<T>, projection?: any) =>
         repo.findOne(filter, projection);
 
     // 3. Vinculamos FIND ONE AND UPDATE (Necesario)
     (ModelClass as any).findOneAndUpdate = (filter: FilterQuery<T>, update: any, options?: any) =>
         repo.findOneAndUpdate(filter, update, options);
*/
    // 4. Implementamos el estático "SAVE" (o "CREATE")
    // Nota: Es mejor llamarlo "create" para no confundirlo con la instancia .save()
    (ModelClass as any).save = async (data: Partial<T>) => {
        const instance = new ModelClass(data);
        return await instance.save();
    };

    // ⚡ ENLACE DIRECTO DE SEGURIDAD
    (ModelClass.prototype as any)._entityClass = entityClass;

    return ModelClass as unknown as Model<T>;
}